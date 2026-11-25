import {canonicalKey} from './travel.ts';
import {sharedLinks} from './shared-links.ts';
import {sourceMatchesURL,validateAnalysis,type ExtractClip} from './analysis.ts';
import {uploadReference,UPLOAD_MAX_BYTES,UPLOAD_MAX_SECONDS,type UploadMetadata} from './uploaded-reel.ts';

export type Reel = {id:string; url:string; platform:'Instagram'|'TikTok'|'Uploaded video'; addedAt:string;title?:string;upload?:UploadMetadata;autoAnalyse?:boolean};
export const LIBRARY_KEY='reeltrip-library-v1';
export function reelID(url:string):string {
 const upload=uploadReference(url);if(upload)return 'upload-'+upload.id;
 try{return canonicalKey(url);}catch{return url;}
}
export function addReels(existing:Reel[],urls:string[]):Reel[]{
 const result=[...existing];
 for(const raw of urls){
  const url=sharedLinks(new URLSearchParams({url:raw})).links[0];
  if(!url)throw new Error('Share or paste an individual public Instagram or TikTok video link.');
  const id=reelID(url);
  if(!result.some(r=>r.id===id))result.unshift({id,url,platform:new URL(url).hostname.includes('tiktok')?'TikTok':'Instagram',addedAt:new Date().toISOString()});
 }
 if(result.length>100)throw new Error('Your Reel Library holds 100 reels. Remove one before adding more.');
 return result;
}
export function uploadedReel(value:unknown):Reel{
 const reel=value as Reel,reference=uploadReference(reel?.url),meta=reel?.upload;
 if(!reference||reel.platform!=='Uploaded video'||reel.id!=='upload-'+reference.id||!meta||meta.id!==reference.id||!['video/mp4','video/quicktime','video/webm'].includes(meta.mimeType)||!Number.isInteger(meta.size)||meta.size<=0||meta.size>UPLOAD_MAX_BYTES||!Number.isFinite(meta.durationSeconds)||meta.durationSeconds<=0||meta.durationSeconds>UPLOAD_MAX_SECONDS||typeof reel.title!=='string'||!reel.title.trim()||reel.title.length>240||/[\u0000-\u001f\u007f]/.test(reel.title)||typeof reel.addedAt!=='string'||!Number.isFinite(Date.parse(reel.addedAt))||typeof meta.expiresAt!=='string'||!Number.isFinite(Date.parse(meta.expiresAt))||Date.parse(meta.expiresAt)<=Date.parse(reel.addedAt))throw new Error('The uploaded video response could not be verified. Please try again.');
 return {id:reel.id,url:reference.url,platform:'Uploaded video',addedAt:reel.addedAt,title:reel.title.trim(),upload:{id:reference.id,expiresAt:meta.expiresAt,mimeType:meta.mimeType,size:meta.size,durationSeconds:meta.durationSeconds},...(typeof reel.autoAnalyse==='boolean'?{autoAnalyse:reel.autoAnalyse}:{})};
}
export function addUploadedReel(existing:Reel[],value:unknown):Reel[]{
 const reel=uploadedReel(value);
 if(existing.some(item=>item.id===reel.id))return existing;
 if(existing.length>=100)throw new Error('Your Reel Library holds 100 reels. Remove one before adding more.');
 return [reel,...existing];
}
export function readLibrary(raw:string|null):Reel[]{
 try{
  const values:unknown=JSON.parse(raw||'[]');if(!Array.isArray(values))return [];
  const valid:Reel[]=[];
  for(const item of values.slice(0,100)){
   if(!item||typeof item.url!=='string'||typeof item.addedAt!=='string'||!Number.isFinite(Date.parse(item.addedAt)))continue;
   try{
    const entry=uploadReference(item.url)?uploadedReel(item):addReels([],[item.url])[0];
    if(!valid.some(r=>r.id===entry.id))valid.push({...entry,addedAt:item.addedAt,...(typeof item.autoAnalyse==='boolean'?{autoAnalyse:item.autoAnalyse}:{})});
   }catch{continue;}
  }
  return valid;
 }catch{return [];}
}
export type AnalysisPhase='idle'|'loading'|'ready'|'unavailable'|'reference'|'not_travel'|'error';
export function analysisPhase(status:string):AnalysisPhase{
 if(status==='analysis_cached'||status==='analysis_completed')return 'ready';
 if(status==='queued'||status==='processing')return 'loading';
 if(status==='service_unavailable'||status==='worker_required')return 'unavailable';
 if(status==='not_travel')return 'not_travel';
 return status==='reference_reviewed'?'reference':'error';
}
export function analysisStageLabel(stage?:string):string{
 const labels:Record<string,string>={queued:'Your reel is in the queue.',acquiring:'Opening the public video.',sampling:'Reading the video’s scenes.',transcribing:'Listening to the creator’s recommendations.',analysing:'Connecting the places, food recommendations and source timestamps.'};
 return labels[stage||'']||'Checking this link for a completed video analysis…';
}
const resumableJob=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
function checkedClip(data:unknown,url:string,job?:string):ExtractClip{
 const envelope=data as {clips?:unknown[]};
 if(!envelope||!Array.isArray(envelope.clips)||envelope.clips.length!==1)throw new Error('The service returned no breakdown. Your reel is still saved.');
 const clip=envelope.clips[0] as ExtractClip;
 if(!clip||!['queued','processing','analysis_completed','analysis_cached','not_travel','reference_reviewed','failed','service_unavailable','worker_required'].includes(clip.status))throw new Error('The service returned an invalid progress update. Your reel is still saved.');
 if(clip.jobId!==undefined&&(!resumableJob(clip.jobId)||(job&&clip.jobId!==job)))throw new Error('The analysis job could not be verified. Please try again.');
 if(analysisPhase(clip.status)==='loading'&&!resumableJob(clip.jobId))throw new Error('The analysis could not be resumed. Please try again.');
 if(clip.message!==undefined&&(typeof clip.message!=='string'||clip.message.length>2000))throw new Error('The service returned an invalid progress update. Your reel is still saved.');
 if(clip.status==='analysis_completed')return {...clip,...validateAnalysis(clip,url)};
 if(clip.status==='analysis_cached'&&(!clip.source||typeof clip.source.id!=='string'||!clip.source.id||typeof clip.source.title!=='string'||!clip.source.title||!sourceMatchesURL(clip.source.source_url,url)||!Array.isArray(clip.source.days)||!Array.isArray(clip.source.unknowns)||!Array.isArray(clip.matches)))throw new Error('The returned breakdown could not be verified. Your reel is still saved.');
 return clip;
}
async function analysisRequest(target:string,options:RequestInit,signal:AbortSignal,fetcher:typeof fetch,requestMs:number):Promise<{response:Response;data:unknown}>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{
  onAbort=()=>{controller.abort(signal.reason);reject(signal.reason||new DOMException('Analysis interrupted.','AbortError'));};
  signal.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>{const error=new Error('The connection took too long. Your reel is saved. Try again to check its progress.');error.name='TimeoutError';controller.abort(error);reject(error);},Math.max(1,Math.min(45000,requestMs)));
  if(signal.aborted)onAbort();
 });
 const request=async()=>{
  let response:Response;
  try{response=await fetcher(target,{...options,signal:controller.signal});}
  catch{if(controller.signal.aborted)throw controller.signal.reason;throw new Error('The connection was interrupted. Your reel is saved. Try again to check its progress.');}
  let data:unknown;
  try{data=await response.json();}catch{if(response.ok)throw new Error('The service returned an unreadable update. Your reel is still saved. Try again.');}
  return {response,data};
 };
 try{return await Promise.race([request(),interrupted]);}
 finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
}
export async function analyseReelURL(url:string,signal:AbortSignal,onProgress:(clip:ExtractClip)=>void,fetcher:typeof fetch=fetch,pollMs=2000,initialJob?:string,retryFailed=false,requestMs=45000):Promise<ExtractClip>{
 const upload=uploadReference(url),endpoint=upload?'/api/upload':'/api/extract';
 if(initialJob!==undefined&&!resumableJob(initialJob))throw new Error('The analysis could not be resumed. Please try again.');
 let job:string|undefined=initialJob;
 let resumed=Boolean(initialJob);
 while(true){
  signal.throwIfAborted();
  const {response,data}=await analysisRequest(job?endpoint+'?job='+encodeURIComponent(job):endpoint,job?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(upload?{uploadId:upload.id,action:'analyse'}:{urls:[url]})},signal,fetcher,requestMs);
  signal.throwIfAborted();
  if(response.status===404&&job&&resumed&&retryFailed){job=undefined;resumed=false;continue;}
  if(!response.ok){const message=(data as {error?:unknown})?.error;throw new Error(typeof message==='string'&&message.trim()&&message.length<=2000?message:response.status===404?'This analysis has expired. Your reel is saved. Choose Try again to start a fresh analysis.':response.status===429?'Too many requests. Your reel is saved. Please try again later.':'We couldn’t check this reel. Your reel is saved. Try again.');}
  const clip=checkedClip(data,url,job);
  // An explicit retry must submit again after a terminal failure. Merely polling
  // that same job can never restart it. Active jobs still resume without duplication.
  if(clip.status==='failed'&&job&&resumed&&retryFailed){job=undefined;resumed=false;continue;}
  onProgress(clip);
  signal.throwIfAborted();
  if(analysisPhase(clip.status)!=='loading')return clip;
  job=clip.jobId;
  await new Promise<void>((resolve,reject)=>{
   const onAbort=()=>{clearTimeout(wait);reject(signal.reason||new Error('Analysis interrupted.'));};
   const wait=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},pollMs);
   signal.addEventListener('abort',onAbort,{once:true});
   if(signal.aborted)onAbort();
  });
 }
}
