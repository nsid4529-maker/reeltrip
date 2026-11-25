import {quota} from '@/lib/server/processing';
import {processorConfig,uuid} from '@/lib/server/processing-client';
import {boundedJSON,ServiceError} from '@/lib/server/http-safety';
import {readRequestBody} from '@/lib/server/request-body';
import {uploadOwner} from '@/lib/server/upload-owner';
import {checkUploadResponse,privateProcessorRequest,UPLOAD_MAX_BYTES,UPLOAD_TYPES,uploadHeaders,uploadLimiter,uploadReference,validateUploadJob,validateUploadMetadata} from '@/lib/server/upload-client';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function errorResponse(error:unknown,cookie?:string){return Response.json({error:error instanceof ServiceError?error.message:'The video could not be uploaded. Please try again.'},{status:error instanceof ServiceError?error.status:503,headers:{...privateHeaders,...(cookie?{'Set-Cookie':cookie}:{})}});}
export async function POST(request:Request){
 let cookie:string|undefined;
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new ServiceError('Invalid upload origin.',403);
  const config=processorConfig(process.env);if(!config)throw new ServiceError('Video uploads are temporarily unavailable.');
  if(request.headers.get('content-type')?.split(';')[0]==='application/json'){
   const owner=await uploadOwner(request,config.token);
   let input:unknown;try{input=JSON.parse(await readRequestBody(request,1024));}catch{throw new ServiceError('Choose a saved uploaded video.',400);}
   const body=input as {action?:unknown;uploadId?:unknown};
   if(!body||body.action!=='analyse'||!uuid(body.uploadId)||Object.keys(body).sort().join(',')!=='action,uploadId')throw new ServiceError('Choose a saved uploaded video.',400);
   uploadReference(body.uploadId);
   try{
    const cached=await privateProcessorRequest(config,owner.owner,'/v1/uploads/'+body.uploadId+'/analysis');
    return Response.json({clips:[validateUploadJob(await boundedJSON(cached,180000),body.uploadId)]},{headers:privateHeaders});
   }catch(error){if(!(error instanceof ServiceError)||error.status!==404)throw error;}
   await quota(request,'analysis');
   const response=await privateProcessorRequest(config,owner.owner,'/v1/uploads/'+body.uploadId+'/jobs','POST');
   return Response.json({clips:[validateUploadJob(await boundedJSON(response,180000),body.uploadId)]},{headers:privateHeaders});
  }
  const {size,mime,filename}=uploadHeaders(request),identity=await uploadOwner(request,config.token,true);cookie=identity.cookie;
  await quota(request,'upload');
  // A fixed-length bounded stream avoids buffering or copying a 50 MB video in the Worker.
  const fixed=new FixedLengthStream(size),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),240000);
  let transferError:unknown;
  const transfer=request.body!.pipeThrough(uploadLimiter(size)).pipeTo(fixed.writable,{signal:controller.signal}).catch(error=>{transferError=error;if(error instanceof ServiceError)controller.abort();});
  let response:Response;
  try{
   response=await fetch(config.url+'/v1/uploads',{method:'POST',headers:{Authorization:'Bearer '+config.token,'X-Upload-Owner':identity.owner,'Content-Type':mime,'Content-Length':String(size),'X-Reel-Filename':encodeURIComponent(filename)},body:fixed.readable,signal:controller.signal,redirect:'manual'});
   if(!response.ok)await checkUploadResponse(response);
   await transfer;
   if(response.ok&&transferError)throw transferError;
  }catch(error){controller.abort();await transfer;throw transferError instanceof ServiceError?transferError:error instanceof ServiceError?error:new ServiceError('The upload connection was interrupted. Please choose the file and try again.');}
  finally{clearTimeout(timer);}
  await checkUploadResponse(response);
  const metadata=validateUploadMetadata(await boundedJSON(response,8000));
  const {id,title,addedAt,...upload}=metadata;
  return Response.json({reel:{id:'upload-'+id,url:uploadReference(id),platform:'Uploaded video',addedAt,title,upload:{id,...upload}},limits:{maxBytes:50000000,maxSeconds:180,retentionDays:7}},{status:201,headers:{...privateHeaders,...(cookie?{'Set-Cookie':cookie}:{})}});
 }catch(error){return errorResponse(error,cookie);}
}
export async function GET(request:Request){
 try{
  const config=processorConfig(process.env);if(!config)throw new ServiceError('Uploaded videos are temporarily unavailable.');
  const {owner}=await uploadOwner(request,config.token),params=new URL(request.url).searchParams;
  if(params.has('job')){
   const job=params.get('job');if(!uuid(job)||params.size!==1)throw new ServiceError('Invalid uploaded analysis request.',400);
   await quota(request,'poll');
   const response=await privateProcessorRequest(config,owner,'/v1/upload-jobs/'+job);
   return Response.json({clips:[validateUploadJob(await boundedJSON(response,180000),undefined,job)]},{headers:privateHeaders});
  }
  const id=params.get('id');if(!uuid(id)||params.size!==1)throw new ServiceError('Choose a saved uploaded video.',400);
  uploadReference(id);
  const range=request.headers.get('range');if(range&&(!/^bytes=\d*-\d*$/.test(range)||range.length>60))throw new ServiceError('Invalid video range.',416);
  await quota(request,'poll');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  let response:Response;
  try{response=await fetch(config.url+'/v1/uploads/'+id,{headers:{Authorization:'Bearer '+config.token,'X-Upload-Owner':owner,...(range?{Range:range}:{})},redirect:'manual',signal:controller.signal});}
  finally{clearTimeout(timer);}
  await checkUploadResponse(response);
  const size=response.headers.get('content-length')||'',mime=response.headers.get('content-type')||'';
  if(!/^\d{1,9}$/.test(size)||Number(size)<=0||Number(size)>UPLOAD_MAX_BYTES||!UPLOAD_TYPES.includes(mime as typeof UPLOAD_TYPES[number]))throw new ServiceError('This uploaded video could not be verified.');
  const headers=new Headers(privateHeaders);for(const key of ['Content-Type','Content-Length','Content-Range','Accept-Ranges']){const value=response.headers.get(key);if(value)headers.set(key,value);}
  headers.set('Content-Disposition','inline');
  return new Response(response.body?.pipeThrough(uploadLimiter(Number(size))),{status:response.status,headers});
 }catch(error){return errorResponse(error);}
}
