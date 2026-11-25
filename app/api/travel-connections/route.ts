import {travelConnections} from '@/lib/travel-connections';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({connections:travelConnections(process.env),directBookingEnabled:false},{headers:{'Cache-Control':'no-store'}});}
