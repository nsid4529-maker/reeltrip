import {sharedRoute,ok} from '@/lib/server/shared-route';
import {joinBucket,previewInvite} from '@/lib/server/shared-buckets';
import {quota} from '@/lib/server/processing';
export const dynamic='force-dynamic';
// {token, preview:true} describes the invite; {token, name?} joins. A device
// with no member yet gives a name and becomes one. The token stays out of URLs.
export async function POST(req:Request){
 return sharedRoute(req,{kind:'shared',body:1024,member:false},async({db,body})=>{
  if(body.preview===true)return ok(await previewInvite(db,req,body.token));
  const result=await joinBucket(db,req,body,()=>quota(req,'member').then(()=>{}));
  return ok({bucketId:result.bucketId,joined:result.joined,member:result.member},result.joined?201:200,result.cookie?{'Set-Cookie':result.cookie}:{});
 });
}
