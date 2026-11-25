import {readRequestBody} from '@/lib/server/request-body';
import { validateDates } from '@/lib/travel';
import {calendarDay,calendarTimeZone} from '@/lib/calendar-day';
import {quota,ServiceError} from '@/lib/server/processing';
import {viatorCatalogConfig,searchViatorCatalog} from '@/lib/server/viator-catalog';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
  if(Number(req.headers.get('content-length')||0)>8192)return Response.json({error:'Request too large.'},{status:413});
  const body=await readRequestBody(req,8192);
  const {query,place,dates,currency,destinationId,timeZone}=JSON.parse(body);
  if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('Enter a search of 1–200 characters.');
  validateDates([dates],calendarDay(calendarTimeZone(timeZone)),true);
  if(!['GBP','EUR','USD','INR'].includes(currency))throw new Error('Choose a supported currency.');
  if(typeof place!=='string'||!place.trim()||place.length>200)throw new Error('Enter a destination of 1–200 characters.');
  if(destinationId!==undefined&&(typeof destinationId!=='string'||! /^[1-9]\d{0,9}$/.test(destinationId)))throw new Error('Choose a valid destination.');
  const config=viatorCatalogConfig(process.env);
  if(!config)return Response.json({error:'Viator API access is not connected yet. You can still open the provider search.',status:'setup_required'},{status:503});
  const data=await searchViatorCatalog(process.env,{query,place:place.trim(),dates,currency,destinationId},async()=>{await quota(req,'availability');});
  if(data.status==='destination_required')return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  const results=data.results.map(p=>{const pricing=p.pricing as {currency?:string;summary?:{fromPrice?:number}}|undefined;return {title:p.title,productCode:p.productCode,productUrl:p.productUrl,pricing:{currency:pricing?.currency,summary:{fromPrice:pricing?.summary?.fromPrice}}};});
  return Response.json({results,destination:data.destination,withheldCount:data.withheldCount,checkedAt:new Date().toISOString(),status:'date_filtered_catalog',environment:config.environment,note:config.environment==='sandbox'?'Sandbox test catalog results — not live inventory or prices. Nothing has been reserved.':'Date-filtered catalog matches. Prices are advertised starting prices, not a quote for your party. Confirm capacity and final price on Viator.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof ServiceError?e.message:'Check your search, dates and party size, then try again.'},{status:e instanceof ServiceError?e.status:400,headers:{'Cache-Control':'no-store'}});}
}
