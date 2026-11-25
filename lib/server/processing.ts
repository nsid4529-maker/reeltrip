import {env} from 'cloudflare:workers';
import {canonicalKey} from '../travel';
import type {ExtractClip,VideoAnalysis} from '../analysis';
import {processorConfig,processorRequest,ServiceError,uuid,type ProcessorJob} from './processing-client';
import {QUOTA_SQL} from './quota-sql';
import {quotaVisitor} from './http-safety';
import {boundedJSON} from './http-safety';
import {uploadOwner} from './upload-owner';
import {privateProcessorRequest,validateUploadJob} from './upload-client';
export {ServiceError};
export function database(){if(!env.DB)throw new ServiceError('This service is temporarily unavailable. Your reel is saved.');return env.DB;}
const ANALYSIS_REVISION='2026-11-24-grounded-retry-v13';
const expiry=()=>Date.now()+86400000;
// New names (members) per network per day. Friends on one home Wi-Fi, or one
// mobile carrier address, share an IP: 30 covers three groups of six set up in
// one place, with retries. Joining still needs a live invite link.
export const MEMBERS_PER_NETWORK=30;
export type QuotaKind='analysis'|'availability'|'poll'|'chat'|'upload'|'member'|'event'|'shared'|'places';
// subject replaces the IP as the per-visitor key, e.g. a member id for per-member caps.
export async function quota(req:Request,kind:QuotaKind,subject?:string){
 const db=database(),window=kind==='poll'?600000:86400000,bucket=Math.floor(Date.now()/window);
 const ip=subject?'subject:'+subject:quotaVisitor(req.headers);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip+':'+bucket));
 const key=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 const limits=kind==='analysis'?[20,100]:kind==='availability'?[60,500]:kind==='chat'?[30,200]:kind==='upload'?[10,25]:kind==='member'?[MEMBERS_PER_NETWORK,1000]:kind==='event'?[1000,100000]:kind==='shared'?[600,100000]:kind==='places'?[100,2000]:[240,20000];
 const visitor=kind+':'+bucket+':'+key,global=kind+':'+bucket+':all';
 const result=await db.prepare(QUOTA_SQL).bind(visitor,limits[0],global,limits[1],visitor,global,(bucket+1)*window).all();
 if(result.results.length!==2)throw new ServiceError(kind==='poll'?'Too many progress checks. Please try again in a few minutes.':kind==='member'?'Too many people have joined ReelTrip from this network today. Switch to mobile data and try again, or try again tomorrow.':'Today’s request limit has been reached. Please try again later.',429);
 await db.prepare('DELETE FROM usage_counters WHERE expires_at < ?').bind(Date.now()-86400000).run();
 // Give back this one charge (visitor and site-wide) when it bought nothing new.
 return {refund:async()=>{await db.prepare('UPDATE usage_counters SET count=count-1 WHERE key IN (?,?) AND count>0').bind(visitor,global).run();}};
}
export async function cachedAnalysis(id:string,request?:Request):Promise<VideoAnalysis|null>{
 if(!id||id.length>100)return null;
 if(id.startsWith('ai-upload-')){
  const identity=id.slice('ai-upload-'.length),config=processorConfig(process.env);
  if(!request||!uuid(identity)||!config)return null;
  try{
   const {owner}=await uploadOwner(request,config.token);
   await quota(request,'poll');
   const response=await privateProcessorRequest(config,owner,'/v1/uploads/'+identity+'/analysis');
   const clip=validateUploadJob(await boundedJSON(response,180000),identity);
   return clip.source&&clip.matches?{source:clip.source,matches:clip.matches}:null;
  }catch(error){if(error instanceof ServiceError&&[404,410].includes(error.status))return null;throw error;}
 }
 const row=await database().prepare("SELECT result FROM analysis_cache WHERE key=? AND expires_at>? AND json_extract(result,'$.cacheVersion')=?").bind(id,Date.now(),ANALYSIS_REVISION).first<{result:string}>();
 return row?JSON.parse(row.result):null;
}
async function finish(job:ProcessorJob,sourceURL:string,publicId:string):Promise<ExtractClip>{
 if(job.analysis){
  // Derive the public cache identity on our side, not from model-supplied metadata.
  const id='ai-'+canonicalKey(job.analysis.source.source_url);
  job.analysis.source.id=id;job.analysis.matches=job.analysis.matches.map((m,i)=>({...m,source:id,id:id+'-'+i}));
  await database().prepare('INSERT INTO analysis_cache (key,source_url,result,expires_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET source_url=excluded.source_url,result=excluded.result,expires_at=excluded.expires_at').bind(id,sourceURL,JSON.stringify({...job.analysis,cacheVersion:job.pipelineVersion}),expiry()).run();
  return {status:'analysis_completed',...job.analysis,jobId:publicId,stage:'complete'};
 }
 if(job.notTravel)return {status:'not_travel',message:job.notTravel,jobId:publicId};
 return {status:job.status,jobId:publicId,stage:job.stage,message:job.message};
}
export async function startAnalysis(req:Request,url:string):Promise<ExtractClip>{
 const config=processorConfig(process.env);
 if(!config)return {status:'service_unavailable',message:'New video analysis is not connected yet. Your reel is saved; you can return to it when analysis is available.'};
 let key='';try{key=canonicalKey(url);}catch{/* Short TikTok links use the exact URL cache below. */}
 if(key){
  const cached=await cachedAnalysis('ai-'+key);
  if(cached)return {status:'analysis_completed',...cached};
 }
 const db=database();
 await db.batch([db.prepare('DELETE FROM analysis_cache WHERE expires_at<?').bind(Date.now()),db.prepare('DELETE FROM processing_jobs WHERE expires_at<?').bind(Date.now())]);
 const cached=await db.prepare("SELECT result FROM analysis_cache WHERE source_url=? AND expires_at>? AND json_extract(result,'$.cacheVersion')=?").bind(url,Date.now(),ANALYSIS_REVISION).first<{result:string}>();
 if(cached)return {status:'analysis_completed',...JSON.parse(cached.result)};
 // The processor merges requests for a URL it is already analysing. Reuse our
 // own record of that job first, so asking again is not charged as a new analysis.
 const existing=await db.prepare('SELECT id,provider_id FROM processing_jobs WHERE source_url=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(url,Date.now()).first<{id:string;provider_id:string}>();
 if(existing){
  await quota(req,'poll');
  try{const job=await processorRequest(config,url,existing.provider_id);if(job.status!=='failed'&&(job.status!=='complete'||job.pipelineVersion===ANALYSIS_REVISION))return finish(job,url,existing.id);}
  catch(error){if(!(error instanceof ServiceError&&error.status===404))throw error;}
 }
 const charge=await quota(req,'analysis');
 const job=await processorRequest(config,url);
 // One atomic statement: a simultaneous request that the processor merged into
 // the same job finds the row already there, keeps its id and is refunded.
 const inserted=await db.prepare('INSERT INTO processing_jobs (id,provider_id,source_url,expires_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM processing_jobs WHERE provider_id=? AND expires_at>?) RETURNING id').bind(crypto.randomUUID(),job.id,url,expiry(),job.id,Date.now()).first<{id:string}>();
 if(inserted)return finish(job,url,inserted.id);
 await charge.refund();
 const shared=await db.prepare('SELECT id FROM processing_jobs WHERE provider_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(job.id,Date.now()).first<{id:string}>();
 if(!shared)throw new ServiceError('Video analysis could not be started. Please try again.');
 return finish(job,url,shared.id);
}
export async function pollAnalysis(req:Request,id:string):Promise<ExtractClip>{
 if(!uuid(id))throw new ServiceError('Invalid video analysis request.',400);
 const config=processorConfig(process.env);if(!config)throw new ServiceError('Video analysis is temporarily unavailable.');
 await quota(req,'poll');
 const job=await database().prepare('SELECT provider_id,source_url FROM processing_jobs WHERE id=? AND expires_at>?').bind(id,Date.now()).first<{provider_id:string;source_url:string}>();
 if(!job)throw new ServiceError('This analysis has expired. Choose Plan trip again.',404);
 return finish(await processorRequest(config,job.source_url,job.provider_id),job.source_url,id);
}
