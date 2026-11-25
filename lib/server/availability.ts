import type {Match} from '../travel.ts';
import {boundedJSON} from './http-safety.ts';
import {openTableSlots,viatorSlots,resySlots,type AvailabilityRequest,type AvailabilityResult} from '../availability.ts';
export type ProviderMapping={opentableId?:number;viatorProductCode?:string;resyUrl?:string};
export type ProviderEnv=Record<string,string|undefined>;
type Fetcher=typeof fetch;
const setup=(m:Match,provider:string,message:string):AvailabilityResult=>({matchId:m.id,provider,status:'setup_required',message,slots:[]});
const unmapped=(m:Match,provider:string):AvailabilityResult=>({matchId:m.id,provider,status:'mapping_required',message:'The exact venue or activity has not been matched to this provider yet.',slots:[]});
function providerError(m:Match,provider:string,status?:number):AvailabilityResult{return {matchId:m.id,provider,status:status===401||status===403?'access_denied':'provider_error',message:status===401||status===403?'This provider has not granted the required access.':status===429?'The provider is busy. Please try again later.':'The provider could not verify availability. Please try again later.',slots:[]};}
export function providerMappings(raw:string|undefined):Record<string,ProviderMapping>{
 try{const value=JSON.parse(raw||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}
function officialBase(raw:string|undefined):string|null{
 if(!raw)return null;
 try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!['.opentable.com','.otenv.com'].some(h=>u.hostname.endsWith(h)))return null;return u.href.replace(/\/$/,'');}catch{return null;}
}
export async function checkOpenTable(m:Match,input:AvailabilityRequest,mapping:ProviderMapping,env:ProviderEnv,fetcher:Fetcher=fetch):Promise<AvailabilityResult>{
 const base=officialBase(env.OPENTABLE_API_BASE_URL);
 if(!env.OPENTABLE_CLIENT_ID||!env.OPENTABLE_CLIENT_SECRET||!base)return setup(m,'OpenTable','Restaurant availability is not connected yet.');
 if(!Number.isInteger(mapping.opentableId)||(mapping.opentableId??0)<=0)return unmapped(m,'OpenTable');
 try{
  const oauth=env.OPENTABLE_ENVIRONMENT==='sandbox'?'https://oauth-pp.opentable.com':'https://oauth.opentable.com';
  const tokenResponse=await fetcher(oauth+'/api/v2/oauth/token?grant_type=client_credentials',{headers:{Authorization:'Basic '+btoa(env.OPENTABLE_CLIENT_ID+':'+env.OPENTABLE_CLIENT_SECRET),Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'manual'});
  if(!tokenResponse.ok)return providerError(m,'OpenTable',tokenResponse.status);
  const token=await boundedJSON<{access_token?:string}>(tokenResponse,16000);if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>8192)return providerError(m,'OpenTable');
  const q=new URLSearchParams({start_date_time:input.dining.date+'T'+input.dining.time,forward_minutes:'120',backward_minutes:'120',party_size:String(input.dining.covers),include_credit_card_results:'true',include_experiences:'false'});
  const response=await fetcher(base+'/v2/availability/'+mapping.opentableId+'?'+q,{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(!response.ok)return providerError(m,'OpenTable',response.status);
  const slots=openTableSlots(await boundedJSON(response),mapping.opentableId!,input.dining.covers,input.dining.date);
  return {matchId:m.id,provider:'OpenTable',environment:env.OPENTABLE_ENVIRONMENT==='sandbox'?'sandbox':'production',status:slots.length?'available':'unavailable',slots,checkedAt:new Date().toISOString(),message:env.OPENTABLE_ENVIRONMENT==='sandbox'?'Sandbox test results — not live restaurant tables.':slots.length?'Times returned for your party. Restaurant-local time; conditions and deposits may apply. Nothing is reserved.':'No times returned for this search window. This does not mean the restaurant is unavailable all day.'};
 }catch{return providerError(m,'OpenTable');}
}
export async function checkViator(m:Match,input:AvailabilityRequest,mapping:ProviderMapping,env:ProviderEnv,fetcher:Fetcher=fetch):Promise<AvailabilityResult>{
 if(!env.VIATOR_API_KEY)return setup(m,'Viator','Live activity availability is not connected yet.');
 if(!['full','full_booking','merchant'].includes(env.VIATOR_ACCESS_LEVEL||''))return {matchId:m.id,provider:'Viator',status:'access_denied',message:'Activity discovery is connected. Live availability for your party needs additional Viator access; use the activity search above and confirm availability on Viator.',slots:[]};
 if(env.VIATOR_ENVIRONMENT!==undefined&&!['sandbox','production'].includes(env.VIATOR_ENVIRONMENT))return providerError(m,'Viator');
 if(!mapping.viatorProductCode||!/^\w{1,40}$/.test(mapping.viatorProductCode))return unmapped(m,'Viator');
 try{
  const base=env.VIATOR_ENVIRONMENT==='sandbox'?'https://api.sandbox.viator.com':'https://api.viator.com';
  const response=await fetcher(base+'/partner/availability/check',{method:'POST',headers:{'exp-api-key':env.VIATOR_API_KEY,Accept:'application/json;version=2.0','Accept-Language':'en','Content-Type':'application/json'},body:JSON.stringify({productCode:mapping.viatorProductCode,travelDate:input.day,currency:input.currency,paxMix:[{ageBand:'ADULT',numberOfTravelers:input.adults}]}),signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(!response.ok)return providerError(m,'Viator',response.status);
  const slots=viatorSlots(await boundedJSON(response),mapping.viatorProductCode,input.day);
  return {matchId:m.id,provider:'Viator',environment:env.VIATOR_ENVIRONMENT==='sandbox'?'sandbox':'production',status:slots.length?'available':'unavailable',slots,checkedAt:new Date().toISOString(),message:env.VIATOR_ENVIRONMENT==='sandbox'?'Sandbox test results — not live activity availability.':slots.length?'Available options returned for the selected day and adult party. Confirm details with the provider; no tickets are held.':'No available options returned for this day and party.'};
 }catch{return providerError(m,'Viator');}
}
export async function checkResy(m:Match,input:AvailabilityRequest,mapping:ProviderMapping,env:ProviderEnv,fetcher:Fetcher=fetch):Promise<AvailabilityResult>{
 const provider='Resy via Apify';
 // Starting an Actor can incur usage charges. Credentials alone do not enable it.
 const cap=Number(env.APIFY_RESY_MAX_CHARGE_USD);
 if(env.APIFY_RESY_ENABLED!=='true'||!env.APIFY_API_TOKEN||!Number.isFinite(cap)||cap<=0||cap>1)return setup(m,provider,'This third-party connection has not been enabled.');
 let venue:URL;
 try{venue=new URL(mapping.resyUrl||'');if(venue.protocol!=='https:'||venue.hostname!=='resy.com'||venue.username||venue.password||venue.port||!/^\/cities\/[^/]+\/[^/]+\/?$/.test(venue.pathname))return unmapped(m,provider);venue.search='';venue.hash='';}catch{return unmapped(m,provider);}
 try{
  const query=new URLSearchParams({timeout:'20',maxItems:'1',maxTotalChargeUsd:String(cap),format:'json'});
  const response=await fetcher('https://api.apify.com/v2/acts/clearpath~resy-api/run-sync-get-dataset-items?'+query,{method:'POST',headers:{Authorization:'Bearer '+env.APIFY_API_TOKEN,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({startUrls:[venue.href],includeAvailability:true,date:input.dining.date,partySize:input.dining.covers,maxItems:1}),signal:AbortSignal.timeout(25000),redirect:'manual'});
  if(!response.ok)return providerError(m,provider,response.status);
  const slots=resySlots(await boundedJSON(response),venue.href,input.dining.date);
  return {matchId:m.id,provider,thirdParty:true,status:slots.length?'available':'unavailable',slots,checkedAt:new Date().toISOString(),message:slots.length?'Third-party results for this restaurant and day, in restaurant-local time. Confirm on Resy; no table is held.':'No times were returned for this restaurant, date and party. Confirm directly on Resy; an empty result does not verify the venue or mean it is fully booked.'};
 }catch{return providerError(m,provider);}
}
export async function checkAvailability(selected:Match[],input:AvailabilityRequest,env:ProviderEnv,fetcher:Fetcher=fetch):Promise<AvailabilityResult[]>{
 const mappings=providerMappings(env.REELTRIP_PROVIDER_MAPPINGS);const jobs:Promise<AvailabilityResult>[]=[];
 for(const m of selected){
  if(m.category==='Food'){
   jobs.push(checkOpenTable(m,input,mappings[m.id]||{},env,fetcher));
   jobs.push(Promise.resolve(setup(m,'SevenRooms','SevenRooms access and the venue’s participation have not been confirmed.')));
   jobs.push(checkResy(m,input,mappings[m.id]||{},env,fetcher));
  }
  else if(m.providers.includes('Viator'))jobs.push(checkViator(m,input,mappings[m.id]||{},env,fetcher));
  else if(m.category==='Stays')jobs.push(Promise.resolve(setup(m,'Booking.com','Live accommodation availability is not connected yet.')));
  else jobs.push(Promise.resolve(setup(m,'Venue website','Check this venue directly for current opening times and reservations.')));
 }
 return Promise.all(jobs);
}
