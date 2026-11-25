import {boundedJSON,ServiceError} from './http-safety.ts';
import {validateAnalysis,type ExtractClip,type VideoAnalysis} from '../analysis.ts';
import {type ProcessorConfig,uuid} from './processing-client.ts';
export const UPLOAD_MAX_BYTES=50_000_000;
export const UPLOAD_TYPES=['video/mp4','video/quicktime','video/webm'] as const;
export type UploadMetadata={id:string;title:string;size:number;mimeType:string;durationSeconds:number;addedAt:string;expiresAt:string;retentionMessage:string};
export const uploadReference=(id:string)=>{if(!uuid(id)||id!==id.toLowerCase())throw new ServiceError('Choose a saved uploaded video.',400);return '/api/upload?id='+id;};
const messages:Record<string,string>={upload_not_found:'This upload is unavailable in this browser. Please upload the video again.',upload_expired:'The original video has expired. Your saved breakdown remains in your library. Upload the video again to analyse it afresh.',upload_too_large:'Choose a video up to 50 MB.',upload_storage_full:'Video upload storage is temporarily full. Try a smaller file or return after older uploads expire.',video_too_long:'Choose a video no longer than three minutes.',media_invalid:'This file could not be read as a playable MP4, MOV or WebM video.',daily_limit:'Today’s video request limit has been reached. Please try again tomorrow.',queue_full:'Video analysis is busy. Your upload is saved; try analysing it again shortly.',not_found:'This uploaded breakdown has expired or is not ready yet.',upload_timeout:'The video upload took too long. Please try again.'};
export async function checkUploadResponse(response:Response):Promise<void>{
 if(response.ok)return;
 let code='';try{code=(await boundedJSON<{error?:{code?:string}}>(response,8000)).error?.code||'';}catch{}
 throw new ServiceError(messages[code]||'Video upload or analysis is temporarily unavailable. Please try again.',[400,404,408,410,413,415,429].includes(response.status)?response.status:503);
}
export function validateUploadMetadata(value:unknown):UploadMetadata{
 const data=value as UploadMetadata;
 if(!data||!uuid(data.id)||data.id!==data.id.toLowerCase()||typeof data.title!=='string'||!data.title.trim()||data.title.length>180||/[\u0000-\u001f]/.test(data.title)||!Number.isInteger(data.size)||data.size<=0||data.size>UPLOAD_MAX_BYTES||!UPLOAD_TYPES.includes(data.mimeType as typeof UPLOAD_TYPES[number])||!Number.isFinite(data.durationSeconds)||data.durationSeconds<=0||data.durationSeconds>180||typeof data.addedAt!=='string'||!Number.isFinite(Date.parse(data.addedAt))||typeof data.expiresAt!=='string'||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.parse(data.addedAt)||Date.parse(data.expiresAt)-Date.parse(data.addedAt)>604801000)throw new ServiceError('The uploaded video could not be verified. Please try again.');
 return {id:data.id,title:data.title,size:data.size,mimeType:data.mimeType,durationSeconds:data.durationSeconds,addedAt:data.addedAt,expiresAt:data.expiresAt,retentionMessage:'The original video is private to this browser and kept for 7 days. A completed breakdown remains saved in your browser; its private server cache lasts 7 days after analysis.'};
}
export function uploadLimiter(size:number){
 let total=0;
 return new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){total+=chunk.byteLength;if(total>size||total>UPLOAD_MAX_BYTES)throw new ServiceError('The uploaded file is larger than expected.',413);controller.enqueue(chunk);},flush(){if(total!==size)throw new ServiceError('The video upload was incomplete. Please try again.',400);}});
}
export function uploadHeaders(request:Request):{size:number;mime:string;filename:string}{
 const declared=request.headers.get('x-reel-size')||request.headers.get('content-length')||'';
 if(!/^\d{1,9}$/.test(declared)||Number(declared)<=0||Number(declared)>UPLOAD_MAX_BYTES)throw new ServiceError('Choose a video file up to 50 MB.',413);
 const contentLength=request.headers.get('content-length');
 if(contentLength!==null&&(!/^\d{1,9}$/.test(contentLength)||Number(contentLength)!==Number(declared)))throw new ServiceError('The video upload size could not be verified.',400);
 const mime=request.headers.get('content-type')?.split(';')[0]||'';
 if(!UPLOAD_TYPES.includes(mime as typeof UPLOAD_TYPES[number]))throw new ServiceError('Choose an MP4, MOV or WebM video.',415);
 let filename='';try{filename=decodeURIComponent(request.headers.get('x-reel-filename')||'');}catch{}
 const extension=mime==='video/mp4'?'.mp4':mime==='video/quicktime'?'.mov':'.webm';
 if(!filename.trim()||filename.length>180||/[\u0000-\u001f]/.test(filename)||!filename.toLowerCase().endsWith(extension))throw new ServiceError('Choose a video with a short file name and matching MP4, MOV or WebM extension.',400);
 if(!request.body)throw new ServiceError('Choose a video file to upload.',400);
 return {size:Number(declared),mime,filename};
}
export async function privateProcessorRequest(config:ProcessorConfig,owner:string,path:string,method='GET',fetcher:typeof fetch=fetch):Promise<Response>{
 if(!/^[0-9a-f]{64}$/.test(owner)||!/^\/v1\/(?:uploads\/[0-9a-f-]{36}(?:\/(?:jobs|analysis))?|upload-jobs\/[0-9a-f-]{36})$/.test(path))throw new ServiceError('Invalid private video request.',400);
 let response:Response;try{response=await fetcher(config.url+path,{method,headers:{Authorization:'Bearer '+config.token,'X-Upload-Owner':owner,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new ServiceError('Your uploaded video is temporarily unavailable. Please try again.');}
 await checkUploadResponse(response);return response;
}
export function validateUploadJob(value:unknown,expectedUpload?:string,expectedJob?:string):ExtractClip{
 const data=value as {id?:unknown;uploadId?:unknown;status?:unknown;stage?:unknown;result?:unknown;error?:{code?:string}};
 if(!data||!uuid(data.id)||!uuid(data.uploadId)||(expectedUpload&&data.uploadId!==expectedUpload)||(expectedJob&&data.id!==expectedJob)||!['queued','processing','complete','failed'].includes(String(data.status)))throw new ServiceError('This uploaded analysis could not be verified.');
 const base={jobId:data.id,stage:['queued','acquiring','sampling','transcribing','analysing','complete','failed'].includes(String(data.stage))?String(data.stage):String(data.status)};
 if(data.status==='complete'){
  if((data.result as {not_travel?:unknown})?.not_travel===true)return {...base,status:'not_travel',message:'This video does not contain enough travel recommendations to create a trip.'};
  let analysis:VideoAnalysis;try{analysis=validateAnalysis(data.result,uploadReference(data.uploadId));}catch{throw new ServiceError('The uploaded video analysis could not be verified.');}
  if(analysis.source.id!=='ai-upload-'+data.uploadId)throw new ServiceError('The uploaded video identity could not be verified.');
  return {...base,status:'analysis_completed',...analysis};
 }
 return {...base,status:String(data.status),...(data.status==='failed'?{message:messages[data.error?.code||'']||'This uploaded video could not be analysed. Your file remains saved until its expiry; try again.'}:{})};
}
