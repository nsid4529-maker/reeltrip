import {readRequestBody} from '@/lib/server/request-body';
import {ServiceError} from '@/lib/server/http-safety';
import {database,quota} from '@/lib/server/processing';
import {currentMember,sameOrigin} from '@/lib/server/members';
import {isEventName,validBucketId,validEventProps} from '@/lib/events';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};

// Records one allow-listed product event in our own database. No third-party
// analytics. The member is taken from the device cookie, never from the body.
export async function POST(req:Request){
 try{
  sameOrigin(req);
  await quota(req,'event');
  let input:{name?:unknown;bucketId?:unknown;props?:unknown};
  try{input=JSON.parse(await readRequestBody(req,2048));}catch(e){throw e instanceof ServiceError?e:new ServiceError('Invalid event.',400);}
  if(!input||typeof input!=='object'||!isEventName(input.name))throw new ServiceError('Unknown event.',400);
  let props,bucketId;
  try{props=validEventProps(input.name,input.props);bucketId=validBucketId(input.bucketId);}catch(e){throw new ServiceError((e as Error).message,400);}
  const db=database(),member=await currentMember(db,req);
  await db.prepare('INSERT INTO events (id,member_id,name,bucket_id,props,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),member?.id??null,input.name,bucketId,JSON.stringify(props),Date.now()).run();
  return new Response(null,{status:204,headers});
 }catch(e){return Response.json({error:e instanceof ServiceError?e.message:'The event could not be recorded.'},{status:e instanceof ServiceError?e.status:503,headers});}
}
