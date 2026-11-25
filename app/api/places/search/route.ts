import {placesRoute} from '@/lib/server/places/route';
import {searchPlaces} from '@/lib/server/places/service';
export const dynamic='force-dynamic';
// Live candidates for "Fix it". Shown to the person searching and never stored.
export async function POST(req:Request){return placesRoute(req,{body:1024},async({db,provider,charge,body})=>({provider:provider?.name??null,candidates:await searchPlaces(db,provider,charge,body.query)}));}
