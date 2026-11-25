import {boundedJSON,ServiceError} from './http-safety.ts';
import {viatorSearchBody} from '../travel.ts';
import {loadViatorTaxonomy,productMatchesDestination} from './viator-destinations.ts';
import type {ViatorCatalogRequest,ViatorDestination,ViatorDestinationRequired} from '../viator-results.ts';
type ProviderEnv=Record<string,string|undefined>;
export function viatorCatalogConfig(env:ProviderEnv):{environment:'sandbox'|'production';key:string;url:string}|null{
 const environment=env.VIATOR_ENVIRONMENT??'production';
 if(environment!=='sandbox'&&environment!=='production')throw new ServiceError('Viator is not configured correctly. You can still open the provider search.');
 if(!env.VIATOR_API_KEY)return null;
 // Only these fixed provider endpoints may receive the secret. Never accept a base URL.
 const base=environment==='sandbox'?'https://api.sandbox.viator.com':'https://api.viator.com';
 return {environment,key:env.VIATOR_API_KEY,url:base+'/partner/search/freetext'};
}
export async function requestViatorCatalog(env:ProviderEnv,body:unknown,fetcher:typeof fetch=fetch):Promise<Response>{
 const config=viatorCatalogConfig(env);
 if(!config)throw new ServiceError('Viator API access is not connected yet. You can still open the provider search.');
 return fetcher(config.url,{method:'POST',headers:{'exp-api-key':config.key,Accept:'application/json;version=2.0','Accept-Language':'en','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'manual'});
}

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const destinationName=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=200;
const normalize=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
export function resolveViatorDestination(payload:unknown,place:string,destinationId?:string):{destination:ViatorDestination}|ViatorDestinationRequired{
 if(!record(payload)||!record(payload.destinations))throw new ServiceError('Viator could not verify this destination. Please try again.');
 const data=payload.destinations;
 // Viator omits results on a confirmed zero-count response.
 const results=data.results===undefined&&data.totalCount===0?[]:data.results;
 if(!Array.isArray(results)||results.length>20||!Number.isSafeInteger(data.totalCount)||(data.totalCount as number)<results.length)throw new ServiceError('Viator could not verify this destination. Please try again.');
 const candidates=results.map((value:unknown):ViatorDestination=>{
  if(!record(value)||!Number.isSafeInteger(value.id)||(value.id as number)<=0||(value.id as number)>9999999999||!destinationName(value.name)||(value.parentDestinationName!=null&&!destinationName(value.parentDestinationName)))throw new ServiceError('Viator could not verify this destination. Please try again.');
  return {id:String(value.id),name:value.name,...(typeof value.parentDestinationName==='string'?{parentName:value.parentDestinationName}:{})};
 });
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw new ServiceError('Viator could not verify this destination. Please try again.');
 const hasMore=(data.totalCount as number)>candidates.length;
 if(destinationId){
  const confirmed=candidates.find(c=>c.id===destinationId);
  if(confirmed)return {destination:confirmed};
 }else{
  const exact=candidates.filter(c=>normalize(c.name)===normalize(place));
  if(exact.length===1&&!hasMore)return {destination:exact[0]};
 }
 const exact=candidates.filter(c=>normalize(c.name)===normalize(place));
 return {status:'destination_required',destinationSearch:place,candidates,hasMore,reason:destinationId?'reselect':!candidates.length?'no_match':exact.length>1?'ambiguous':'confirm'};
}

export async function searchViatorCatalog(env:ProviderEnv,request:ViatorCatalogRequest,beforeRequest:()=>Promise<void>,fetcher:typeof fetch=fetch):Promise<ViatorDestinationRequired|{status:'date_filtered_catalog';destination:ViatorDestination;results:Record<string,unknown>[];withheldCount:number}>{
 const config=viatorCatalogConfig(env);
 if(!config)throw new ServiceError('Viator API access is not connected yet. You can still open the provider search.');
 const call=async(body:unknown)=>{
  await beforeRequest();
  const response=await requestViatorCatalog(env,body,fetcher);
  if(!response.ok)throw new ServiceError(response.status===429?'Viator is busy. Please try again later.':'Viator could not return results. Please try again later.',response.status===429?429:502);
  return boundedJSON(response);
 };
 const lookup=await call({searchTerm:request.place,searchTypes:[{searchType:'DESTINATIONS',pagination:{start:1,count:20}}],currency:request.currency});
 const resolution=resolveViatorDestination(lookup,request.place,request.destinationId);
 if(!('destination' in resolution))return resolution;
 // Never fall back to an unrestricted global product search.
 const data=await call(viatorSearchBody(request.query,request.dates,request.currency,resolution.destination.id));
 if(!record(data)||!record(data.products))throw new ServiceError('Viator returned incomplete activity results. Please try again.');
 const results=data.products.results===undefined&&data.products.totalCount===0?[]:data.products.results;
 if(!Array.isArray(results)||results.length>20||results.some(p=>!record(p)))throw new ServiceError('Viator returned incomplete activity results. Please try again.');
 if(!results.length)return {status:'date_filtered_catalog',destination:resolution.destination,results,withheldCount:0};
 const taxonomy=await loadViatorTaxonomy(config,beforeRequest,fetcher);
 const verified=results.filter(p=>productMatchesDestination(p,resolution.destination.id,taxonomy));
 return {status:'date_filtered_catalog',destination:resolution.destination,results:verified,withheldCount:results.length-verified.length};
}
