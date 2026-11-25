import {boundedJSON,ServiceError} from './http-safety.ts';

type Environment='sandbox'|'production';
type Taxonomy=ReadonlyMap<string,ReadonlySet<string>>;
const MAX_NODES=20000,MAX_BYTES=5000000,WEEK=7*86400000;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,9}$/.test(value);
const invalid=()=>new ServiceError('Activity locations could not be verified. Please try again later.');

export function parseViatorTaxonomy(payload:unknown):Taxonomy{
 if(!record(payload)||!Array.isArray(payload.destinations)||payload.destinations.length<1||payload.destinations.length>MAX_NODES||payload.totalCount!==payload.destinations.length)throw invalid();
 const taxonomy=new Map<string,ReadonlySet<string>>();
 for(const value of payload.destinations){
  if(!record(value)||!Number.isSafeInteger(value.destinationId)||(value.destinationId as number)<=0||typeof value.lookupId!=='string'||value.lookupId.length>256)throw invalid();
  const destinationId=String(value.destinationId),lineage=value.lookupId.split('.');
  if(!id(destinationId)||!lineage.length||lineage.length>20||lineage.some(part=>!id(part))||lineage.at(-1)!==destinationId||new Set(lineage).size!==lineage.length||taxonomy.has(destinationId))throw invalid();
  taxonomy.set(destinationId,new Set(lineage));
 }
 return taxonomy;
}

export function productMatchesDestination(product:Record<string,unknown>,destinationId:string,taxonomy:Taxonomy):boolean{
 if(!taxonomy.has(destinationId)||!Array.isArray(product.destinations)||product.destinations.length>100)return false;
 // Any documented destination may establish scope; primary often reflects departure.
 return product.destinations.some(ref=>record(ref)&&id(ref.ref)&&taxonomy.get(ref.ref)?.has(destinationId)===true);
}

export function createViatorTaxonomyCache(now:()=>number=Date.now){
 const cache:Partial<Record<Environment,{expires:number;taxonomy:Taxonomy}>>={};
 const pending:Partial<Record<Environment,Promise<Taxonomy>>>={};
 return async function load(config:{environment:Environment;key:string},beforeRequest:()=>Promise<void>,fetcher:typeof fetch=fetch):Promise<Taxonomy>{
  if(config.environment!=='sandbox'&&config.environment!=='production')throw invalid();
  const environment=config.environment;
  if(cache[environment]&&cache[environment]!.expires>now())return cache[environment]!.taxonomy;
  if(pending[environment])return pending[environment]!;
  const task=(async()=>{
   await beforeRequest();
   const base=environment==='sandbox'?'https://api.sandbox.viator.com':'https://api.viator.com';
   const response=await fetcher(base+'/partner/destinations',{method:'GET',headers:{'exp-api-key':config.key,Accept:'application/json;version=2.0','Accept-Language':'en'},signal:AbortSignal.timeout(15000),redirect:'manual'});
   if(!response.ok)throw invalid();
   const taxonomy=parseViatorTaxonomy(await boundedJSON(response,MAX_BYTES));
   cache[environment]={taxonomy,expires:now()+WEEK};
   return taxonomy;
  })();
  pending[environment]=task;
  try{return await task;}finally{delete pending[environment];}
 };
}

// At most two bounded maps per worker, with no API keys retained in cache entries.
export const loadViatorTaxonomy=createViatorTaxonomyCache();
