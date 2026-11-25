import {sharedRoute,ok} from '@/lib/server/shared-route';
import {deleteSharedBucket,getBucket} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// One bucket: members, reels with who added them, places with vote tallies.
export async function GET(req:Request){return sharedRoute(req,{kind:'poll'},async({db,member})=>ok(await getBucket(db,req,member,new URL(req.url).searchParams.get('id'))));}
// The owner deletes the bucket and everything linked to it.
export async function DELETE(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>ok(await deleteSharedBucket(db,member,body.bucketId)));}
