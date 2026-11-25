export const GUEST_ITINERARY_KEY='reeltrip-itinerary-v1';
// A missing scope deliberately means the original guest workspace. An invalid
// supplied scope must never fall back to that key and overwrite the guest plan.
export function itineraryStorageKey(scopeId?:string):string|null{
 if(scopeId===undefined)return GUEST_ITINERARY_KEY;
 return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scopeId)?'reeltrip-trip-itinerary-v1:'+scopeId.toLowerCase():null;
}

import type {Base,Itinerary} from './itinerary.ts';
export type SavedItinerary={version:1;draft:Itinerary|null;notes:Record<string,string>;base:Base};
export type ItinerarySnapshot={raw:string|null;record:SavedItinerary};
type Store=Pick<Storage,'getItem'|'setItem'>;
export const ITINERARY_CHANGED='reeltrip:itinerary-changed';
const damaged='Your saved itinerary could not be read. Existing data has been kept unchanged; you can still export your draft.';
const conflict='The saved itinerary changed in another tab. Your unsaved changes are kept here. Load the saved version before replacing it, or export this draft.';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max:number,empty=false):value is string=>typeof value==='string'&&value.length<=max&&(empty||!!value.trim());
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const strings=(value:unknown,max:number,length:number):value is string[]=>Array.isArray(value)&&value.length<=length&&value.every(item=>text(item,max));
function validDraft(value:unknown):value is Itinerary{
 if(!object(value)||!text(value.signature,900000)||!text(value.base,2000)||!['ella','sigiriya','coast','custom'].includes(String(value.region))||!text(value.stayId,100,true)||!strings(value.includedSources,100,12)||!strings(value.otherSources,100,12)||!strings(value.warnings,200000,64)||!text(value.createdAt,40)||!/^\d{4}-\d{2}-\d{2}T/.test(value.createdAt)||!Number.isFinite(Date.parse(value.createdAt)))return false;
 if(!Array.isArray(value.days)||value.days.length<1||value.days.length>31||!Number.isInteger(value.nights)||value.nights!==value.days.length-1)return false;
 const seen=new Set<string>();
 for(const day of value.days){
  if(!object(day)||!date(day.date)||seen.has(day.date)||!text(day.title,2000)||!Array.isArray(day.stops)||day.stops.length>32)return false;
  seen.add(day.date);
  for(const stop of day.stops){
   if(!object(stop)||!text(stop.period,100)||!text(stop.title,2000)||!text(stop.detail,10000)||stop.source!==undefined&&!text(stop.source,100)||stop.matchId!==undefined&&!text(stop.matchId,100)||stop.second!==undefined&&(typeof stop.second!=='number'||!Number.isFinite(stop.second)||stop.second<0||stop.second>180))return false;
   if(stop.alsoSources!==undefined&&(!Array.isArray(stop.alsoSources)||stop.alsoSources.length>12||stop.alsoSources.some(item=>!object(item)||!text(item.source,100)||typeof item.second!=='number'||!Number.isFinite(item.second)||item.second<0||item.second>180)))return false;
  }
 }
 return true;
}
export function readSavedItinerary(raw:string|null):SavedItinerary{
 if(raw===null)return {version:1,draft:null,notes:{},base:'auto'};
 try{
  if(raw.length>1_000_000)throw Error();
  const value:unknown=JSON.parse(raw);
  // Accept the original unversioned shape, but never reset an unfamiliar record.
  if(!object(value)||(value.version!==undefined&&value.version!==1)||Object.keys(value).some(key=>!['version','draft','notes','base'].includes(key))||(value.draft!==null&&!validDraft(value.draft))||!object(value.notes)||Object.keys(value.notes).length>31||!['auto','ella','sigiriya','coast'].includes(String(value.base)))throw Error();
  const days=new Set(value.draft?(value.draft as Itinerary).days.map(day=>day.date):[]);
  for(const [day,note]of Object.entries(value.notes))if(!date(day)||!days.has(day)||!text(note,3000,true))throw Error();
  return {version:1,draft:value.draft as Itinerary|null,notes:{...value.notes} as Record<string,string>,base:value.base as Base};
 }catch{throw new Error(damaged);}
}
export function loadSavedItinerary(storage:Pick<Storage,'getItem'>,key:string):ItinerarySnapshot{
 const raw=storage.getItem(key);return {raw,record:readSavedItinerary(raw)};
}
function write(storage:Store,key:string,record:SavedItinerary):ItinerarySnapshot{
 const raw=JSON.stringify(record),checked=readSavedItinerary(raw);storage.setItem(key,raw);return {raw,record:checked};
}
// Merge only explicitly edited days. A changed draft or same-day conflict must
// not silently overwrite another tab; unrelated day notes remain independent.
export function editSavedItinerary(storage:Store,key:string,expected:ItinerarySnapshot,edits:{notes:Record<string,string>;base?:Base}):ItinerarySnapshot{
 const latest=loadSavedItinerary(storage,key);
 if(JSON.stringify(latest.record.draft)!==JSON.stringify(expected.record.draft))throw new Error(conflict);
 for(const [day,note]of Object.entries(edits.notes))if((latest.record.notes[day]||'')!==(expected.record.notes[day]||'')&&latest.record.notes[day]!==note)throw new Error(conflict);
 if(edits.base!==undefined&&latest.record.base!==expected.record.base&&latest.record.base!==edits.base)throw new Error(conflict);
 return write(storage,key,{...latest.record,notes:{...latest.record.notes,...edits.notes},base:edits.base??latest.record.base});
}
export function replaceSavedItinerary(storage:Store,key:string,expected:ItinerarySnapshot,draft:Itinerary,base:Base,notes:Record<string,string>={}):ItinerarySnapshot{
 const latest=loadSavedItinerary(storage,key);
 if(latest.raw!==expected.raw)throw new Error(conflict);
 return write(storage,key,{version:1,draft,notes,base});
}
