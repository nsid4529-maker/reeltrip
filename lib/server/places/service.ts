import {matches as catalogMatches} from '../../travel.ts';
import {ServiceError} from '../http-safety.ts';
import {resolve,isNamedVenue,type Confidence,type PlaceInput} from './match.ts';
import {PLACE_ID,ProviderError,type PlacesProvider,type ProviderName,type PlaceDetails} from './provider.ts';
import {roleIn,type Database} from '../shared-buckets.ts';
import type {Member} from '../members.ts';

// Store only the provider's place ID and ReelTrip's own match data. Coordinates
// are fetched live for the map and never persisted, including during inactivity.
// "Last checked" is verified_at: when ReelTrip last confirmed the match still
// resolves. It is re-checked when the place is viewed and 30 days have passed.
const DAY=86400000;
export const VERIFY_AFTER=30*DAY,MAX_PLACES=40;
export type PlaceStatus='matched'|'possible'|'unmatched'|'not_a_venue'|'not_a_place'|'not_checked';
export type PlaceView={key:string;status:PlaceStatus;confidence:Confidence|'confirmed';placeId:string|null;provider:ProviderName|null;lat:number|null;lng:number|null;checkedAt:number|null;fixedBy:{id:string;name:string}|null;fixed:boolean};
type Row={scope:string;place_key:string;status:PlaceStatus;confidence:Confidence|'confirmed';provider:ProviderName|null;provider_place_id:string|null;matched_at:number;verified_at:number;fixed_by:string|null;fixed_by_name?:string|null};
export type Charge=()=>Promise<void>;

const text=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';
async function shortHash(value:string){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return Array.from(d.slice(0,6),b=>b.toString(16).padStart(2,'0')).join('');}
// Analysis IDs can retain the same source/position while naming a different venue.
// Only an identical lookup input may reuse an automatic match (or an old miss).
const resolutionKey=async(input:PlaceInput)=>input.key+'#'+await shortHash(JSON.stringify([input.title,input.place,input.query||'',input.kind||'',input.category||'']));
const day=()=>new Date().toISOString().slice(0,10);

export function cleanInput(raw:unknown):PlaceInput|null{
 const v=raw as Record<string,unknown>;
 const key=text(v?.key,160);if(!key||!/^[\w.:#-]+$/.test(key))return null;
 return {key,title:text(v.title,200),place:text(v.place,200),query:text(v.query,400),kind:text(v.kind,100),category:text(v.category,40)};
}

// Use the server's own copy of a place where it has one (catalogue, analysis
// cache, shared bucket snapshot), so a client cannot change what everyone sees.
async function trusted(db:Database,key:string,bucketId:string|null):Promise<PlaceInput|null>{
 // The reviewed catalogue is the most trusted copy, and older shared snapshots lack each place's kind.
 const catalog=catalogMatches.find(m=>m.id===key);
 if(bucketId){
  const {results}=await db.prepare("SELECT analysis FROM bucket_reels WHERE bucket_id=? AND status IN ('ready','analysing')").bind(bucketId).all<{analysis:string}>();
  let inBucket=false;
  for(const row of results){try{const found=(JSON.parse(row.analysis).places||[]).find((p:Record<string,unknown>)=>p.id===key);if(found){if(!catalog)return cleanInput({...found,key});inBucket=true;break;}}catch{}}
  // A shared bucket may only use places that are actually in it.
  if(!inBucket)return null;
 }
 if(catalog)return cleanInput({...catalog,key});
 const ai=key.match(/^(ai-[a-z]+-[\w-]+)-\d+$/);
 if(ai){
  const row=await db.prepare('SELECT result FROM analysis_cache WHERE key=?').bind(ai[1]).first<{result:string}>();
  if(row){try{const found=(JSON.parse(row.result).matches||[]).find((m:Record<string,unknown>)=>m.id===key);if(found)return cleanInput({...found,key});}catch{}}
 }
 return null;
}

function view(row:Row|null,key:string):PlaceView{
 if(!row)return {key,status:'not_checked',confidence:'none',placeId:null,provider:null,lat:null,lng:null,checkedAt:null,fixedBy:null,fixed:false};
 const checkedAt=(row.status==='matched'||row.status==='possible')&&row.provider&&row.provider_place_id?row.verified_at:null;
 return {key,status:row.status,confidence:row.confidence,placeId:row.provider_place_id,provider:row.provider,lat:null,lng:null,checkedAt,
  fixedBy:row.fixed_by?{id:row.fixed_by,name:row.fixed_by_name||'A former member'}:null,fixed:row.scope!=='global'};
}
const read=(db:Database,scope:string,key:string)=>db.prepare('SELECT r.*,m.display_name AS fixed_by_name FROM place_resolutions r LEFT JOIN members m ON m.id=r.fixed_by WHERE r.scope=? AND r.place_key=?').bind(scope,key).first<Row>();
async function write(db:Database,row:Omit<Row,'fixed_by_name'>){
 await db.prepare(`INSERT INTO place_resolutions (scope,place_key,status,confidence,provider,provider_place_id,matched_at,verified_at,fixed_by) VALUES (?,?,?,?,?,?,?,?,?)
  ON CONFLICT(scope,place_key) DO UPDATE SET status=excluded.status,confidence=excluded.confidence,provider=excluded.provider,provider_place_id=excluded.provider_place_id,matched_at=excluded.matched_at,verified_at=excluded.verified_at,fixed_by=excluded.fixed_by`)
  .bind(row.scope,row.place_key,row.status,row.confidence,row.provider,row.provider_place_id,row.matched_at,row.verified_at,row.fixed_by).run();
}
export const logCall=(db:Database,provider:ProviderName,kind:'search'|'details')=>db.prepare('INSERT INTO provider_calls (day,provider,kind,count) VALUES (?,?,?,1) ON CONFLICT(day,provider,kind) DO UPDATE SET count=count+1').bind(day(),provider,kind).run();

// Every provider call is charged to the caller's daily cap and counted.
async function call<T>(db:Database,provider:PlacesProvider,kind:'search'|'details',charge:Charge,run:()=>Promise<T>):Promise<T>{
 await charge();await logCall(db,provider.name,kind);return run();
}

async function check(db:Database,provider:PlacesProvider,charge:Charge,input:PlaceInput,storeKey:string,row:Row|null):Promise<Row>{
 const now=Date.now();
 // Re-verify a stored match by id first (one details call); search only if it is gone.
 if(row?.provider_place_id&&row.provider===provider.name&&(row.status==='matched'||row.status==='possible')){
  const details=await call(db,provider,'details',charge,()=>provider.details(row.provider_place_id!));
  if(details){const next={...row,verified_at:now};await write(db,next);return next;}
 }
 const candidates=await call(db,provider,'search',charge,()=>provider.search(input.query||input.title+' '+input.place));
 const result=resolve(input,candidates);
 const next:Row={scope:'global',place_key:storeKey,status:result.status,confidence:result.confidence,provider:provider.name,provider_place_id:result.candidate?.id??null,matched_at:now,verified_at:now,fixed_by:null};
 await write(db,next);return next;
}

export async function resolvePlaces(db:Database,provider:PlacesProvider|null,charge:Charge,rawPlaces:unknown,bucketId:string|null):Promise<PlaceView[]>{
 if(!Array.isArray(rawPlaces)||rawPlaces.length>MAX_PLACES)throw new ServiceError('Send up to 40 places at a time.',400);
 const inputs=rawPlaces.map(raw=>{const input=cleanInput(raw);if(!input)throw new ServiceError('Invalid place.',400);return input;});
 const out:PlaceView[]=[];let stopped=false;
 const guardedCharge=async()=>{if(stopped)throw new ServiceError('Places could not be checked right now.',429);await charge();};
 async function one(given:PlaceInput):Promise<PlaceView>{
  const known=await trusted(db,given.key,bucketId),input=known||given;
  // Fingerprint the trusted input too; reanalysis must not inherit another venue's match.
  const storeKey=await resolutionKey(input);
  if(bucketId){
   const fix=await read(db,bucketId,given.key);
   if(fix){
    // A confirmed venue is re-checked by id after 30 days; if it is gone, say so.
    if(fix.provider_place_id&&provider&&fix.provider===provider.name&&!stopped&&fix.verified_at<=Date.now()-VERIFY_AFTER){
      try{const details=await call(db,provider,'details',guardedCharge,()=>provider.details(fix.provider_place_id!)),now=Date.now();
      await write(db,details?{...fix,verified_at:now}:{...fix,status:'unmatched',confidence:'none',provider_place_id:null,verified_at:now});}
     catch(error){if(error instanceof ProviderError||(error instanceof ServiceError&&error.status===429))stopped=true;else throw error;}
      return view(await read(db,bucketId,given.key),given.key);
    }
     return view(fix,given.key);
   }
  }
  const row=await read(db,'global',storeKey);
  if(!isNamedVenue(input)){
    if(!row){const now=Date.now();await write(db,{scope:'global',place_key:storeKey,status:'not_a_venue',confidence:'none',provider:null,provider_place_id:null,matched_at:now,verified_at:now,fixed_by:null});return view(await read(db,'global',storeKey),given.key);}
    return view(row,given.key);
  }
  const fresh=row&&row.verified_at>Date.now()-VERIFY_AFTER&&(!provider||row.provider===provider.name);
   if(fresh||!provider||stopped)return view(row,given.key);
   try{return view(await check(db,provider,guardedCharge,input,storeKey,row),given.key);}
  catch(error){
    // Already in-flight calls may finish; start no new calls after a cap/outage.
    if(error instanceof ProviderError||(error instanceof ServiceError&&error.status===429)){stopped=true;return view(row,given.key);}
   throw error;
  }
 }
 // Independent venues can be checked together. Duplicate keys stay serial to reuse their cached match.
 const workers=new Set(inputs.map(p=>p.key)).size===inputs.length?Math.min(3,inputs.length):1;
 let cursor=0;
 const results=await Promise.allSettled(Array.from({length:workers},async()=>{try{while(cursor<inputs.length){const index=cursor++;out[index]=await one(inputs[index]);}}catch(error){stopped=true;throw error;}}));
 const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
 return out;
}

export async function searchPlaces(db:Database,provider:PlacesProvider|null,charge:Charge,query:unknown){
 const q=text(query,200).trim();if(q.length<2)throw new ServiceError('Type at least two characters to search.',400);
 if(!provider)throw new ServiceError('Venue search is not connected yet.',503);
 try{return (await call(db,provider,'search',charge,()=>provider.search(q))).map(c=>({id:c.id,name:c.name,address:c.address}));}
 catch(error){if(error instanceof ProviderError)throw new ServiceError(error.message,503);throw error;}
}
// Live details for showing a venue. Returned to the viewer and never stored.
export async function placeDetails(db:Database,provider:PlacesProvider|null,charge:Charge,id:unknown):Promise<PlaceDetails&{provider:ProviderName}>{
 if(typeof id!=='string'||!PLACE_ID.test(id))throw new ServiceError('Choose a venue.',400);
 if(!provider)throw new ServiceError('Venue details are not connected yet.',503);
 let details:PlaceDetails|null;
 try{details=await call(db,provider,'details',charge,()=>provider.details(id));}
 catch(error){if(error instanceof ProviderError)throw new ServiceError(error.message,503);throw error;}
 if(!details)throw new ServiceError('That venue could not be found. It may have closed.',404);
 return {...details,provider:provider.name};
}

// A fix in a shared bucket applies for everyone in it and records who made it.
// Votes are keyed by the ReelTrip place key, which a fix never changes.
export async function fixSharedPlace(db:Database,provider:PlacesProvider|null,charge:Charge,member:Member,input:{bucketId?:unknown;key?:unknown;placeId?:unknown;notAPlace?:unknown;reset?:unknown}){
 await roleIn(db,input.bucketId,member.id);
 const bucketId=input.bucketId as string,key=typeof input.key==='string'?input.key:'';
 const known=key?await trusted(db,key,bucketId):null;
 if(!known)throw new ServiceError('Choose a place in this bucket.',400);
 if(input.reset===true){await db.prepare('DELETE FROM place_resolutions WHERE scope=? AND place_key=?').bind(bucketId,key).run();return view(await read(db,'global',await resolutionKey(known)),key);}
 const now=Date.now();
 if(input.notAPlace===true){
  await write(db,{scope:bucketId,place_key:key,status:'not_a_place',confidence:'confirmed',provider:null,provider_place_id:null,matched_at:now,verified_at:now,fixed_by:member.id});
 }else{
  const details=await placeDetails(db,provider,charge,input.placeId);
  await write(db,{scope:bucketId,place_key:key,status:'matched',confidence:'confirmed',provider:details.provider,provider_place_id:details.id,matched_at:now,verified_at:now,fixed_by:member.id});
 }
 return view(await read(db,bucketId,key),key);
}
