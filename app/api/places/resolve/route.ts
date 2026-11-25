import {placesRoute} from '@/lib/server/places/route';
import {resolvePlaces} from '@/lib/server/places/service';
import {roleIn} from '@/lib/server/shared-buckets';
import {ServiceError} from '@/lib/server/http-safety';
export const dynamic='force-dynamic';
// {places:[{key,title,place,query,kind,category}], bucketId?} → each place's venue match.
export async function POST(req:Request){
 return placesRoute(req,{body:60000},async({db,member,provider,charge,body})=>{
  let bucketId:string|null=null;
  if(body.bucketId!==undefined){if(!member)throw new ServiceError('Add your name on this device first.',401);await roleIn(db,body.bucketId,member.id);bucketId=body.bucketId as string;}
  return {provider:provider?.name??null,places:await resolvePlaces(db,provider,charge,body.places,bucketId)};
 });
}
