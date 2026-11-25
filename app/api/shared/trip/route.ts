import {sharedRoute,ok} from '@/lib/server/shared-route';
import {setTripDetails} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// The owner sets trip dates and travellers: {bucketId,start,end,travellers}.
export async function POST(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>ok(await setTripDetails(db,member,body.bucketId,body)));}
