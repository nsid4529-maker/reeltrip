import rawCatalog from '@/lib/catalog.json';
import type {VideoSource} from '@/lib/analysis';
import {matches} from '@/lib/travel';
import {validateChat,chatContext,validateChatReply,resolveChatAnalyses} from '@/lib/bundle-chat';
import {readRequestBody} from '@/lib/server/request-body';
import {boundedJSON,ServiceError} from '@/lib/server/http-safety';
import {cachedAnalysis,quota} from '@/lib/server/processing';
import {processorConfig} from '@/lib/server/processing-client';
const reviewed=(rawCatalog as VideoSource[]).map(source=>({source,matches:matches.filter(m=>m.source===source.id)}));
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const headers={'Cache-Control':'no-store'};
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)throw new ServiceError('Invalid request origin.',403);
  let input;try{input=validateChat(JSON.parse(await readRequestBody(req,115000)));}catch{throw new ServiceError('Choose up to 12 reels and 30 interested places, then send a short question.',400);}
  const config=processorConfig(process.env);if(!config)throw new ServiceError('Trip chat is temporarily unavailable.');
  let analyses;try{analyses=await resolveChatAnalyses(input.analysisIds,reviewed,id=>cachedAnalysis(id,req));}catch(e){if(e instanceof Error&&e.message.startsWith('A breakdown has expired.'))throw new ServiceError(e.message,409);throw e;}
  const context=chatContext(analyses,input.selectedInterests,input.preferences);
  context[0]={...context[0],video_source_counts:{completed:analyses.length,total:input.total}};
  const payload=JSON.stringify({context,messages:input.messages,total:Math.max(context.length,input.total)});
  if(new TextEncoder().encode(payload).length>119000)throw new ServiceError('This conversation is too long. Start a fresh question or choose fewer interested places.',400);
  await quota(req,'chat');
  const response=await fetch(config.url+'/v1/chat',{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(65000),redirect:'manual'});
  if(!response.ok)throw new ServiceError(response.status===429?'Trip chat has reached its request limit. Try again later.':'Trip chat could not answer right now.',response.status===429?429:503);
  const reply=validateChatReply(await boundedJSON(response,24000),analyses,input.selectedInterests,context);
  return Response.json(reply,{headers});
 }catch(e){return Response.json({error:e instanceof ServiceError?e.message:'Trip chat could not answer right now. Please try again.'},{status:e instanceof ServiceError?e.status:503,headers});}
}
