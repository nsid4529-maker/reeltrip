import {placesRoute} from '@/lib/server/places/route';
import {fixSharedPlace} from '@/lib/server/places/service';
import {ServiceError} from '@/lib/server/http-safety';
export const dynamic='force-dynamic';
// Fix a place in a shared bucket for everyone: {bucketId,key,placeId} picks a
// venue, {notAPlace:true} marks it not a real place, {reset:true} undoes the fix.
export async function POST(req:Request){
 return placesRoute(req,{body:1024},async({db,member,provider,charge,body})=>{
  if(!member)throw new ServiceError('Add your name on this device first.',401);
  return fixSharedPlace(db,provider,charge,member,body);
 });
}
