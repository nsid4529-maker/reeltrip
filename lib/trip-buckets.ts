import type {Reel} from './reel-library.ts';
import {LIBRARY_KEY,readLibrary} from './reel-library.ts';
import type {ReelBucket} from './reel-buckets.ts';
import {BUCKETS_KEY,readBuckets} from './reel-buckets.ts';

export const TRIPS_KEY='reeltrip-trips-v1';
export const TRIPS_CHANGED='reeltrip:trips-changed';
export const TRIPS_LIMIT=20;
export const TRIP_REELS_LIMIT=12;
export const TRIP_INTERESTS_LIMIT=200;
export type TripBucket={id:string;name:string;destination:string;bundleIds:string[];reelIds:string[];interestIds:string[];dates:{start:string;end:string}[];activeDate:number;adults:number;currency:string;brief:string;createdAt:string;updatedAt:string};
export type TripPatch=Partial<Pick<TripBucket,'name'|'destination'|'bundleIds'|'reelIds'|'interestIds'|'dates'|'activeDate'|'adults'|'currency'|'brief'>>;
export type TripReferenceField='bundleIds'|'reelIds'|'interestIds';
export type TripStore={version:1;trips:TripBucket[];activeId:string|null};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const damaged='Your trip buckets could not be read. Existing data has been kept unchanged.';
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function text(value:unknown,max:number,required=false,preserveWhitespace=false):string{
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)||(required&&!value.trim()))throw new Error('A trip field is missing or too long.');
 return preserveWhitespace?value:value.trim();
}
function refs(value:unknown,max:number):string[]{
 if(!Array.isArray(value)||value.length>1000)throw new Error('The trip has too many saved references.');
 const ids=[...new Set(value.map(id=>text(id,1024,true)))];
 if(ids.length>max)throw new Error(max===200?'A trip holds up to 200 interested places.':'The trip has too many saved references.');
 return ids;
}
function date(value:unknown):string{
 if(value==='')return '';
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error('Choose valid calendar dates.');
 return value;
}
function timestamp(value:unknown):string{
 if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Invalid trip timestamp.');
 return value;
}
function trip(value:unknown):TripBucket{
 if(!record(value)||!uuid(value.id)||!Array.isArray(value.dates)||value.dates.length<1||value.dates.length>3)throw new Error('Choose one to three date options.');
 const dates=value.dates.map(w=>{if(!record(w))throw new Error('Choose valid calendar dates.');return {start:date(w.start),end:date(w.end)};});
 if(!Number.isInteger(value.activeDate)||Number(value.activeDate)<0||Number(value.activeDate)>=dates.length||!Number.isInteger(value.adults)||Number(value.adults)<1||Number(value.adults)>8||!['GBP','EUR','USD','INR'].includes(String(value.currency)))throw new Error('Choose valid trip preferences.');
 return {id:value.id,name:text(value.name,80,true),destination:text(value.destination,160),bundleIds:refs(value.bundleIds,20),reelIds:refs(value.reelIds,TRIP_REELS_LIMIT),interestIds:refs(value.interestIds,TRIP_INTERESTS_LIMIT),dates,activeDate:Number(value.activeDate),adults:Number(value.adults),currency:String(value.currency),brief:text(value.brief,3000,false,true),createdAt:timestamp(value.createdAt),updatedAt:timestamp(value.updatedAt)};
}
export function readTrips(raw:string|null):TripStore{
 if(raw===null)return {version:1,trips:[],activeId:null};
 try{
  if(raw.length>1_000_000)throw new Error(damaged);
  const value:unknown=JSON.parse(raw);
  if(!record(value)||value.version!==1||!Array.isArray(value.trips)||value.trips.length>TRIPS_LIMIT)throw new Error(damaged);
  const trips=value.trips.map(trip);
  if(new Set(trips.map(t=>t.id)).size!==trips.length||(value.activeId!==null&&(!uuid(value.activeId)||!trips.some(t=>t.id===value.activeId))))throw new Error(damaged);
  return {version:1,trips,activeId:value.activeId as string|null};
 }catch{throw new Error(damaged);}
}
export function loadTrips(storage:StorageLike):TripStore{return readTrips(storage.getItem(TRIPS_KEY));}
function write(storage:StorageLike,state:TripStore):TripStore{
 const raw=JSON.stringify(state);readTrips(raw);storage.setItem(TRIPS_KEY,raw);return state;
}
export function createTrip(storage:StorageLike,name:string,destination='',now=new Date().toISOString()):TripStore{
 const state=loadTrips(storage);
 if(state.trips.length>=TRIPS_LIMIT)throw new Error('You can keep up to 20 trip buckets. Remove one before creating another.');
 const item=trip({id:crypto.randomUUID(),name,destination,bundleIds:[],reelIds:[],interestIds:[],dates:[{start:'',end:''}],activeDate:0,adults:2,currency:'GBP',brief:'',createdAt:now,updatedAt:now});
 if(state.trips.some(t=>t.name.toLocaleLowerCase()===item.name.toLocaleLowerCase()))throw new Error('A trip already has that name. Choose another name.');
 return write(storage,{...state,trips:[item,...state.trips],activeId:item.id});
}
export function selectTrip(storage:StorageLike,id:string|null):TripStore{
 const state=loadTrips(storage),activeId=id||null;
 if(activeId&&!state.trips.some(t=>t.id===activeId))throw new Error('That trip is no longer saved. Choose another trip.');
 return write(storage,{...state,activeId});
}
export function getTripReels(selected:Pick<TripBucket,'bundleIds'|'reelIds'>,bundles:ReelBucket[],reels:Reel[]){
 const ids=new Set(selected.reelIds),missingBundleIds:string[]=[];
 for(const id of new Set(selected.bundleIds)){
  const bundle=bundles.find(b=>b.id===id);if(!bundle){missingBundleIds.push(id);continue;}
  for(const reelId of bundle.reelIds)ids.add(reelId);
 }
 const byId=new Map(reels.map(r=>[r.id,r])),resolved:Reel[]=[],missingReelIds:string[]=[];
 for(const id of ids){const reel=byId.get(id);if(reel)resolved.push(reel);else missingReelIds.push(id);}
 return {reels:resolved,missingBundleIds,missingReelIds,total:ids.size,overLimit:ids.size>TRIP_REELS_LIMIT};
}
const patchKeys=new Set(['name','destination','bundleIds','reelIds','interestIds','dates','activeDate','adults','currency','brief']);
export function updateTrip(storage:StorageLike,id:string,patch:TripPatch,now=new Date().toISOString()):TripStore{
 const state=loadTrips(storage),current=state.trips.find(t=>t.id===id);
 if(!current)throw new Error('That trip is no longer saved. Choose another trip.');
 if(!record(patch)||Object.keys(patch).some(key=>!patchKeys.has(key)))throw new Error('This trip change is not supported.');
 const item=trip({...current,...patch,updatedAt:now});
 if(state.trips.some(t=>t.id!==id&&t.name.toLocaleLowerCase()===item.name.toLocaleLowerCase()))throw new Error('A trip already has that name. Choose another name.');
 if(patch.bundleIds!==undefined||patch.reelIds!==undefined){
  const bundles=readBuckets(storage.getItem(BUCKETS_KEY)),reels=readLibrary(storage.getItem(LIBRARY_KEY));
  const before=getTripReels(current,bundles,reels),after=getTripReels(item,bundles,reels);
  // A bundle can grow after attachment. Keep every reference visible and allow
  // removal to repair that state, but do not add more over the planning limit.
  if(after.overLimit&&after.total>=before.total)throw new Error('A trip can plan up to 12 unique reels. Remove a reel or bundle before adding another.');
 }
 return write(storage,{...state,trips:state.trips.map(t=>t.id===id?item:t)});
}
export function removeTrip(storage:StorageLike,id:string):TripStore{
 const state=loadTrips(storage);
 if(!state.trips.some(t=>t.id===id))throw new Error('That trip is no longer saved.');
 return write(storage,{...state,trips:state.trips.filter(t=>t.id!==id),activeId:state.activeId===id?null:state.activeId});
}
export function assignTripInterest(storage:StorageLike,interestId:string,include:boolean,tripId?:string):TripStore{
 const state=loadTrips(storage),id=tripId||state.activeId,current=state.trips.find(t=>t.id===id);
 if(!current)throw new Error('Choose a trip bucket before adding an interested place.');
 return changeTripReferences(storage,current.id,'interestIds',[interestId],include);
}
export function changeTripReferences(storage:StorageLike,tripId:string,field:TripReferenceField,ids:string[],include:boolean):TripStore{
 if(!['bundleIds','reelIds','interestIds'].includes(field)||typeof include!=='boolean')throw new Error('This trip reference change is not supported.');
 const state=loadTrips(storage),current=state.trips.find(trip=>trip.id===tripId);
 if(!current)throw new Error('That trip is no longer saved. Choose another trip.');
 const references=refs(ids,field==='interestIds'?TRIP_INTERESTS_LIMIT:field==='bundleIds'?20:TRIP_REELS_LIMIT);
 const next=include?[...new Set([...current[field],...references])]:current[field].filter(id=>!references.includes(id));
 if(next.length===current[field].length&&next.every((id,index)=>id===current[field][index]))return state;
 return updateTrip(storage,tripId,{[field]:next});
}
