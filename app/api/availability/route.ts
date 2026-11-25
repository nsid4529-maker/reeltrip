import {readRequestBody} from '@/lib/server/request-body';
import {matches} from '@/lib/travel';
import {validateAvailability,type AvailabilityRequest} from '@/lib/availability';
import {checkAvailability} from '@/lib/server/availability';
import {cachedAnalysis,quota,ServiceError} from '@/lib/server/processing';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const headers={'Cache-Control':'no-store'};
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Invalid request origin.'},{status:403,headers});
  const raw=await readRequestBody(req,8192);
  const input=JSON.parse(raw) as AvailabilityRequest;validateAvailability(input);
  const sourceIds=input.analysisIds??(input.analysisId?[input.analysisId]:[]);
  if(!Array.isArray(sourceIds)||sourceIds.length>12||sourceIds.some(x=>typeof x!=='string'||x.length>100))throw new Error('Choose analyses from your library.');
  const analyses=await Promise.all([...new Set(sourceIds)].map(id=>cachedAnalysis(id,req)));
  if(analyses.some(a=>!a))throw new Error('A video analysis has expired. Choose Plan trip again.');
  const all=[...matches,...analyses.flatMap(a=>a?.matches||[])];
  const ids=[...new Set(input.matchIds)],selected=ids.map(id=>all.find(m=>m.id===id));
  if(selected.some(m=>!m))throw new Error('Choose places from the reel breakdown.');
  // No remote provider call can escape the durable per-visitor and daily quota.
  if(process.env.VIATOR_API_KEY||process.env.OPENTABLE_CLIENT_SECRET||process.env.APIFY_RESY_ENABLED==='true')await quota(req,'availability');
  const results=await checkAvailability(selected as typeof matches,input,process.env);
  return Response.json({results,requestDate:input.day,note:'Availability is checked for the selected day and party. No reservation has been made.'},{headers});
 }catch(e){return Response.json({error:e instanceof SyntaxError?'Invalid request.':e instanceof ServiceError?e.message:e instanceof Error&&e.message.startsWith('Choose')?e.message:e instanceof Error&&e.message.includes('expired')?e.message:'Check your dates and party size, then try again.'},{status:e instanceof ServiceError?e.status:400,headers});}
}
