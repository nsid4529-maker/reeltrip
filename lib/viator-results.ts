import {validateDates,type Match,type Window} from './travel.ts';
import {localTimeZone} from './calendar-day.ts';

const currencies=['GBP','EUR','USD','INR'];
export type ViatorCatalogRequest={query:string;place:string;dates:Window;currency:string;timeZone?:string;destinationId?:string};
export type ViatorDestination={id:string;name:string;parentName?:string};
export type ViatorDestinationRequired={status:'destination_required';destinationSearch:string;candidates:ViatorDestination[];hasMore:boolean;reason:'no_match'|'ambiguous'|'confirm'|'reselect'};
export type ViatorCatalogItem={title:string;productCode:string;productUrl:string;price?:{amount:number;currency:string}};
export type ViatorCatalogResults={status:'date_filtered_catalog';results:ViatorCatalogItem[];destination:ViatorDestination;withheldCount:number;environment:'sandbox'|'production';checkedAt:string};
export type ViatorSearchResult=ViatorCatalogResults|ViatorDestinationRequired;

export function viatorProductURL(value:unknown):string|null{
 if(typeof value!=='string'||value.length>2048||/[\s\u0000-\u001f\u007f]/.test(value))return null;
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||!['viator.com','www.viator.com'].includes(url.hostname)||url.username||url.password||url.port)return null;
  return url.href;
 }catch{return null;}
}

export function viatorCatalogRequest(match:Match,dates:Window,currency:string,place=match.place,destinationId?:string):ViatorCatalogRequest{
 if(!['Experiences','Transport'].includes(match.category))throw new Error('Choose an activity or transport recommendation from your reel.');
 if(typeof match.query!=='string'||!match.query.trim()||match.query.length>200)throw new Error('This recommendation needs a shorter provider search. Use its provider link above.');
 validateDates([dates],undefined,true);
 if(!currencies.includes(currency))throw new Error('Choose a supported currency above.');
 if(typeof place!=='string'||!place.trim()||place.length>200)throw new Error('Enter a city or region for this activity.');
 if(destinationId!==undefined&&(typeof destinationId!=='string'||!/^[1-9]\d{0,9}$/.test(destinationId)))throw new Error('Choose a destination from Viator’s matching locations.');
 // Keep the source-specific query intact; do not replace it with a generic destination search.
 return {query:match.query,place:place.trim(),dates:{start:dates.start,end:dates.end},currency,timeZone:localTimeZone(),...(destinationId?{destinationId}:{})};
}

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const malformed=()=>new Error('Viator returned incomplete results. Please try again or open the provider search.');

export function parseViatorDestination(value:unknown):ViatorDestination{
 if(!object(value)||typeof value.id!=='string'||! /^[1-9]\d{0,9}$/.test(value.id)||!text(value.name,200)||(value.parentName!==undefined&&!text(value.parentName,200)))throw malformed();
 return {id:value.id,name:value.name,...(typeof value.parentName==='string'?{parentName:value.parentName}:{})};
}

export function parseViatorDestinationRequired(value:unknown):ViatorDestinationRequired{
 if(!object(value)||value.status!=='destination_required'||!text(value.destinationSearch,200)||!Array.isArray(value.candidates)||value.candidates.length>20||typeof value.hasMore!=='boolean'||typeof value.reason!=='string'||!['no_match','ambiguous','confirm','reselect'].includes(value.reason))throw malformed();
 const candidates=value.candidates.map(parseViatorDestination);
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw malformed();
 return {status:'destination_required',destinationSearch:value.destinationSearch,candidates,hasMore:value.hasMore,reason:value.reason as ViatorDestinationRequired['reason']};
}

export function parseViatorCatalog(value:unknown,currency:string):ViatorCatalogResults{
 if(!object(value)||value.status!=='date_filtered_catalog'||(value.environment!=='sandbox'&&value.environment!=='production')||!Array.isArray(value.results)||value.results.length>20||!text(value.checkedAt,40)||!/^\d{4}-\d{2}-\d{2}T/.test(value.checkedAt)||!Number.isFinite(Date.parse(value.checkedAt)))throw malformed();
 if(!currencies.includes(currency))throw malformed();
 if(!Number.isInteger(value.withheldCount)||(value.withheldCount as number)<0||(value.withheldCount as number)>20)throw malformed();
 const results=value.results.map((item:unknown):ViatorCatalogItem=>{
  if(!object(item)||!text(item.title,500)||!text(item.productCode,100))throw malformed();
  const productUrl=viatorProductURL(item.productUrl);
  if(!productUrl)throw malformed();
  let price:ViatorCatalogItem['price'];
  if(item.pricing!==undefined){
   if(!object(item.pricing))throw malformed();
   const summary=item.pricing.summary;
   if(summary!==undefined&&!object(summary))throw malformed();
   const amount=object(summary)?summary.fromPrice:undefined;
   if(amount!==undefined){
    if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||item.pricing.currency!==currency)throw malformed();
    price={amount,currency};
   }
  }
  return {title:item.title.trim(),productCode:item.productCode,productUrl,...(price?{price}:{})};
 });
 return {status:'date_filtered_catalog',results,destination:parseViatorDestination(value.destination),withheldCount:value.withheldCount as number,environment:value.environment as ViatorCatalogResults['environment'],checkedAt:new Date(value.checkedAt).toISOString()};
}

export async function loadViatorCatalog(request:ViatorCatalogRequest,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ViatorSearchResult>{
 const response=await fetcher('/api/viator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal,cache:'no-store'});
 const payload:unknown=await response.json().catch(()=>null);
 if(!response.ok){
  if(object(payload)&&payload.status==='setup_required')throw new Error('Viator search is not connected yet. You can still open the provider search below.');
  if(response.status===429||(object(payload)&&payload.providerStatus===429))throw new Error('Viator search is busy. Please try again shortly.');
  throw new Error('Viator could not return results. Please try again or open the provider search below.');
 }
 if(object(payload)&&payload.status==='destination_required'){
  const result=parseViatorDestinationRequired(payload);
  if(result.destinationSearch!==request.place)throw malformed();
  return result;
 }
 const result=parseViatorCatalog(payload,request.currency);
 if(request.destinationId&&result.destination.id!==request.destinationId)throw malformed();
 return result;
}
