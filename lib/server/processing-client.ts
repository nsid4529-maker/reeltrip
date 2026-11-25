import {validateAnalysis,type VideoAnalysis} from '../analysis.ts';
import {boundedJSON,ServiceError} from './http-safety.ts';
export {ServiceError};
export type ProcessorConfig={url:string;token:string};
export type ProcessorJob={id:string;status:'queued'|'processing'|'complete'|'failed';stage:string;analysis?:VideoAnalysis;pipelineVersion?:string;notTravel?:string;message?:string};
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function processorConfig(env:Record<string,string|undefined>):ProcessorConfig|null{
 try{const u=new URL(env.REELTRIP_PROCESSOR_URL||'');if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!env.REELTRIP_PROCESSOR_TOKEN)return null;return {url:u.href.replace(/\/$/,''),token:env.REELTRIP_PROCESSOR_TOKEN};}catch{return null;}
}
export async function processorRequest(config:ProcessorConfig,sourceURL:string,id?:string,fetcher:typeof fetch=fetch):Promise<ProcessorJob>{
 if(id&&!uuid(id))throw new ServiceError('Invalid processing job.',400);
 let response:Response;
 try{response=await fetcher(config.url+'/v1/jobs'+(id?'/'+id:''),{method:id?'GET':'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json',Accept:'application/json'},...(id?{}:{body:JSON.stringify({url:sourceURL})}),signal:AbortSignal.timeout(15000),redirect:'manual'});}catch{throw new ServiceError('Video analysis is taking longer to connect. Please try again shortly.');}
 if(!response.ok){
  if(id&&response.status===404)throw new ServiceError('This analysis has expired. Your reel is saved. Choose Try again to start a fresh analysis.',404);
  throw new ServiceError(response.status===429?'Video analysis is busy. Please try again later.':'Video analysis is temporarily unavailable. Your reel is saved.',response.status===429?429:503);
 }
 // Never reflect an upstream URL, response body, token or traceback to a guest.
 const data=await boundedJSON<Record<string,unknown>>(response,180000);
 if(!uuid(data?.id)||(id&&data.id!==id)||!['queued','processing','complete','failed'].includes(String(data.status)))throw new ServiceError('The video analysis could not be verified.');
 const stages=['queued','acquiring','sampling','transcribing','analysing','complete','failed'];
 const job:ProcessorJob={id:data.id,status:data.status as ProcessorJob['status'],stage:stages.includes(String(data.stage))?String(data.stage):String(data.status)};
 if(job.status==='complete'){
  const result=data.result as Record<string,unknown>;
  job.pipelineVersion=typeof result?.pipeline_version==='string'?result.pipeline_version:undefined;
  if(result?.not_travel===true){job.notTravel='This video does not contain enough travel recommendations to create a trip.';return job;}
  try{
   if(/^https:\/\/(vm|vt)\.tiktok\.com\//.test(sourceURL)){
    const provenance=result?.provenance as {original_url?:string};if(provenance?.original_url?.replace(/\/$/,'')!==sourceURL.replace(/\/$/,''))throw new Error('Short link mismatch');
   }
   job.analysis=validateAnalysis(result,sourceURL);
  }catch{throw new ServiceError('The video analysis could not be verified. Please try again.');}
 }
 if(job.status==='failed'){
  const code=(data.error as {code?:string})?.code;
  const messages:Record<string,string>={
   short_link_unsupported:'Open this TikTok in a browser and share its full video link.',
   not_travel:'This video does not contain travel recommendations.',
   source_unavailable:'ReelTrip could not open this video from its link. Instagram or TikTok can restrict access even when it plays in your account. Your reel is saved. Open the original to check it, then try again or upload a saved video file.',
   video_too_long:'This prototype supports reels up to three minutes long. Your reel is saved; choose a shorter video for analysis.',
   media_invalid:'The video or its audio could not be read. Your reel is saved. Try again or choose another video.',
   media_timeout:'Reading this video took too long. Your reel is saved. Try again or choose a shorter video.',
   processing_timeout:'Analysis took too long. Your reel is saved. Try again or choose a shorter video.',
   service_restarted:'Analysis was interrupted while ReelTrip was updating. Your reel is saved. Tap Try again to restart it.',
   service_busy:'Video analysis is busy. Your reel is saved. Please try again shortly.',
   service_unavailable:'Video analysis is temporarily unavailable. Your reel is saved. Please try again shortly.',
   analysis_invalid:'ReelTrip could not reliably match the breakdown to this video. Your reel is saved. Try again to create a fresh analysis.',
   analysis_incomplete:'The breakdown did not finish. Your reel is saved. Try again to create a fresh analysis.',
  };
  job.message=messages[code||'']||'We could not finish analysing this video. Your reel is saved. Try again to start a fresh analysis.';
 }
 return job;
}
