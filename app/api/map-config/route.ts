import {mapConfig} from '@/lib/server/map-config';
export const dynamic='force-dynamic';
// Public map settings for the browser: the website-restricted Maps key and Map ID.
export async function GET(){return Response.json(mapConfig(process.env),{headers:{'Cache-Control':'no-store'}});}
