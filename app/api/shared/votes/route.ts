import {sharedRoute,ok} from '@/lib/server/shared-route';
import {castVote} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// value 1 (up), -1 (down) or 0 (clear). One vote per member per place.
export async function POST(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>{await castVote(db,member,body.bucketId,body.placeKey,body.value);return ok({voted:body.value});});}
