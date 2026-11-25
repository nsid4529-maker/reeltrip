import {ServiceError} from './http-safety.ts';
import {readRequestBody} from './request-body.ts';
import {database,quota,type QuotaKind} from './processing.ts';
import {sameOrigin} from './members.ts';
import {requireMember,type Database} from './shared-buckets.ts';
import type {Member} from './members.ts';

export const sharedHeaders={'Cache-Control':'no-store','Vary':'Cookie'};
type Context={db:Database;member:Member;body:Record<string,unknown>};
// Same safety order as the other routes: origin, rate limit, then the body.
export async function sharedRoute(req:Request,options:{kind:QuotaKind;body?:number;member?:boolean},run:(context:Context)=>Promise<Response>):Promise<Response>{
 try{
  sameOrigin(req);
  const db=database() as unknown as Database;
  const member=options.member===false?null:await requireMember(db,req);
  await quota(req,options.kind);
  let body:Record<string,unknown>={};
  if(options.body){try{const value=JSON.parse(await readRequestBody(req,options.body));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();body=value;}catch(e){throw e instanceof ServiceError?e:new ServiceError('Invalid request.',400);}}
  return await run({db,member:member as Member,body});
 }catch(e){
  const cookie=(e as {cookie?:string})?.cookie;
  return Response.json({error:e instanceof ServiceError?e.message:'The shared bucket could not be updated. Please try again.'},{status:e instanceof ServiceError?e.status:503,headers:{...sharedHeaders,...(cookie?{'Set-Cookie':cookie}:{})}});
 }
}
export const ok=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{...sharedHeaders,...extra}});
