import {sharedRoute,ok} from '@/lib/server/shared-route';
import {setShortlist} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// Any member marks the shortlist agreed ({agreed:true}) or undoes it ({agreed:false}).
export async function POST(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>ok(await setShortlist(db,member,body.bucketId,body.agreed)));}
