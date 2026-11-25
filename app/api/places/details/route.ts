import {placesRoute} from '@/lib/server/places/route';
import {placeDetails} from '@/lib/server/places/service';
export const dynamic='force-dynamic';
// Live venue name, address and Maps link. Fetched when a place is opened; never stored.
export async function GET(req:Request){return placesRoute(req,{},async({db,provider,charge})=>placeDetails(db,provider,charge,new URL(req.url).searchParams.get('id')));}
