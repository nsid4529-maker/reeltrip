import {sharedRoute,ok} from '@/lib/server/shared-route';
import {addReel,removeReel} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// Any member can add a reel. It goes through the normal analysis cache and quota.
export async function POST(req:Request){return sharedRoute(req,{kind:'shared',body:2048},async({db,member,body})=>{const result=await addReel(db,req,member,body.bucketId,body.url,body.refresh===true);return ok(result,result.added?201:200);});}
// Only whoever added the reel, or the owner, can remove it.
export async function DELETE(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>{await removeReel(db,member,body.bucketId,body.reelId);return ok({removed:true});});}
