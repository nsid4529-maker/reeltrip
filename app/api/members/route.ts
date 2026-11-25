import {readRequestBody} from '@/lib/server/request-body';
import {ServiceError} from '@/lib/server/http-safety';
import {database,quota} from '@/lib/server/processing';
import {createMember,currentMember,memberName,sameOrigin} from '@/lib/server/members';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};

// Creates a member for this device: {name} in, {id,name} out plus a cookie.
// A device that already has a member keeps it; nothing here is required for guests.
export async function POST(req:Request){
 try{
  sameOrigin(req);
  const db=database();
  const existing=await currentMember(db,req);
  if(existing)return Response.json({...existing,existing:true},{headers});
  await quota(req,'member');
  let input:unknown;try{input=JSON.parse(await readRequestBody(req,1024));}catch{throw new ServiceError('Enter your name in 1–40 characters.',400);}
  const name=memberName((input as {name?:unknown})?.name);
  const {member,cookie}=await createMember(db,name);
  return Response.json(member,{status:201,headers:{...headers,'Set-Cookie':cookie}});
 }catch(e){return Response.json({error:e instanceof ServiceError?e.message:'Your name could not be saved. Please try again.'},{status:e instanceof ServiceError?e.status:503,headers});}
}
