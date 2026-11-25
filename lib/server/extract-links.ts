import {ServiceError} from './http-safety.ts';

export type LinkClip={status:string;url?:string;message?:string;[key:string]:unknown};
export type LinkOutcome={clips:LinkClip[];failure?:ServiceError};

// Check every link before any paid work starts, then give each link its own
// result. A later link failing must never discard a job already started for
// an earlier link: the caller needs that job id to keep polling it.
export async function extractEach(urls:string[],normalise:(raw:string)=>string|null,analyse:(url:string)=>Promise<LinkClip>):Promise<LinkOutcome>{
 const links=[...new Set(urls)].map(raw=>{const url=normalise(raw);if(!url)throw new ServiceError('Use an individual public Instagram or TikTok video link.',400);return url;});
 const clips:LinkClip[]=[];let failure:ServiceError|undefined,succeeded=0;
 for(const url of links){
  try{clips.push(await analyse(url));succeeded++;}
  catch(error){
   const known=error instanceof ServiceError?error:new ServiceError('Video analysis could not be started. Please try again.');
   failure??=known;
   clips.push({status:'error',url,message:known.message});
  }
 }
 // With nothing started there is no job to keep, so report the first error the
 // way a single-link request always has (an HTTP error with its message).
 return succeeded===0&&failure?{clips:[],failure}:{clips};
}
