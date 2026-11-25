import {sharedRoute,ok} from '@/lib/server/shared-route';
import {createSharedBucket,listBuckets} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// Your shared buckets.
export async function GET(req:Request){return sharedRoute(req,{kind:'poll'},async({db,member})=>ok({buckets:await listBuckets(db,member)}));}
// Create a shared bucket, optionally bringing a personal bucket's reel links.
export async function POST(req:Request){return sharedRoute(req,{kind:'shared',body:16000},async({db,member,body})=>ok(await createSharedBucket(db,req,member,body),201));}
