import type {Match} from './travel.ts';
import {matchedBookingPage} from './booking-pages.ts';
import {calendarDate,getYourGuideActivity,getYourGuideActivityUrl} from './getyourguide.ts';
import {providerProduct} from './provider-links-save.ts';

export const INTERESTS_KEY='reeltrip.interested.v1';
export const INTERESTS_LIMIT=200;
export const INTERESTS_CHANGED='reeltrip:interested-changed';
export type InterestInput={kind:'restaurant'|'activity'|'hotel'|'flight';title:string;place:string;provider:string;url:string;sourceId?:string;notes?:string;titleSource?:'provider'|'link'|'user'|'reel';identityTitle?:string;identityPlace?:string};
export type Interest=InterestInput&{id:string;addedAt:string};
type Store=Pick<Storage,'getItem'|'setItem'>;
const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max?value.trim():null;
const words=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();

export function interestUrl(value:unknown):string|null{
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020]/.test(value))return null;
 try{const u=new URL(value);const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.internal')||host.startsWith('[')||/^\d+(\.\d+)*$/.test(host))return null;
  u.hash='';return u.href;
 }catch{return null;}
}

function cleanInput(value:unknown):InterestInput|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>,title=text(v.title,240),provider=text(v.provider,80),url=interestUrl(v.url);
 if(!['restaurant','activity','hotel','flight'].includes(String(v.kind))||!title||!provider||!url||typeof v.place!=='string'||v.place.length>240)return null;
 const sourceId=v.sourceId===undefined?undefined:text(v.sourceId,160);
 if(sourceId===null)return null;
 if(v.notes!==undefined&&(typeof v.notes!=='string'||v.notes.length>600))return null;
 if(v.titleSource!==undefined&&!['provider','link','user','reel'].includes(String(v.titleSource)))return null;
 if(v.identityTitle!==undefined&&!text(v.identityTitle,240))return null;
 if(v.identityPlace!==undefined&&(typeof v.identityPlace!=='string'||v.identityPlace.length>240))return null;
 if((v.identityTitle===undefined)!==(v.identityPlace===undefined))return null;
 const product=providerProduct(url);
 if(v.kind==='flight'&&product?.kind!=='flight')return null;
 const titleSource=(v.titleSource||(product?'provider':sourceId?'reel':'user')) as InterestInput['titleSource'];
 return {kind:v.kind as InterestInput['kind'],title,place:v.place.trim(),provider,url,...(sourceId?{sourceId}:{}),titleSource,...(typeof v.notes==='string'&&v.notes.trim()?{notes:v.notes.trim()}:{}),...(typeof v.identityTitle==='string'&&typeof v.identityPlace==='string'?{identityTitle:v.identityTitle.trim(),identityPlace:v.identityPlace.trim()}:{})};
}

export function interestKey(input:InterestInput):string{
 const item=cleanInput(input);if(!item)throw new Error('This place cannot be saved. Check its name and link.');
 const product=providerProduct(item.url);
 if(product&&product.kind===item.kind)return product.identity;
 const u=new URL(item.url),gyg=getYourGuideActivity(item.url);
 if(item.kind==='activity'&&gyg)return 'activity:getyourguide:'+gyg.id;
 const viator=u.hostname==='www.viator.com'?u.pathname.match(/\/d\d+-([A-Za-z0-9_]+)\/?$/)?.[1]:null;
 if(item.kind==='activity'&&viator)return 'activity:viator:'+viator;
 if(item.kind==='restaurant'&&((/^www\.opentable\.(com|co\.uk)$/.test(u.hostname)&&u.pathname.startsWith('/r/'))||(u.hostname==='www.sevenrooms.com'&&u.pathname.startsWith('/explore/'))))return 'restaurant:'+u.hostname+u.pathname.replace(/\/$/,'');
 return item.kind+':'+JSON.stringify([words(item.identityTitle??item.title),words(item.identityPlace??item.place)]);
}

const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const IMPORT_HISTORY_LIMIT=1000;
type InterestStore={items:Interest[];nativeImportIds:string[]};
function decode(raw:string|null):InterestStore{
 if(raw===null)return {items:[],nativeImportIds:[]};
 if(raw.length>1_000_000)throw new Error('Your Interested list is too large to read safely.');
 const value=JSON.parse(raw);
 if(!value||value.version!==1||!Array.isArray(value.items)||value.items.length>INTERESTS_LIMIT)throw new Error('Your Interested list could not be read. It has been kept unchanged.');
 if(value.nativeImportIds!==undefined&&(!Array.isArray(value.nativeImportIds)||value.nativeImportIds.length>IMPORT_HISTORY_LIMIT||!value.nativeImportIds.every(uuid)))throw new Error('Your Interested list could not be read. It has been kept unchanged.');
 const seen=new Set<string>(),items:Interest[]=[];
 for(const candidate of value.items){
  const item=cleanInput(candidate);
  if(!item||typeof candidate.addedAt!=='string'||!Number.isFinite(Date.parse(candidate.addedAt)))continue;
  const id=interestKey(item);if(seen.has(id))continue;seen.add(id);
  items.push({...item,id,addedAt:candidate.addedAt});
 }
 return {items,nativeImportIds:[...new Set<string>((value.nativeImportIds||[]).map((id:string)=>id.toLowerCase()))]};
}
export function readInterests(raw:string|null):Interest[]{try{return decode(raw).items;}catch{return [];}}
export function loadInterests(storage:Store):Interest[]{return decode(storage.getItem(INTERESTS_KEY)).items;}

// Read current storage for every mutation rather than writing a stale React
// snapshot. A failed read/write must not report success.
export function changeInterest(storage:Store,input:InterestInput,action:'toggle'|'add'|'remove'='toggle',now=new Date().toISOString()):Interest[]{
 const item=cleanInput(input);if(!item)throw new Error('This place cannot be saved. Check its name and link.');
 const state=decode(storage.getItem(INTERESTS_KEY)),id=interestKey(item),current=state.items,exists=current.some(row=>row.id===id);
 if(action==='add'&&exists){
  // An explicit provider result can improve a link-derived label, but never
  // replace the user's edited name or notes. Product identity stays stable.
  const previous=current.find(row=>row.id===id)!;
  const promoted=previous.titleSource==='link'&&item.titleSource==='provider';
  const enriched={...previous,...(promoted?{title:item.title,titleSource:item.titleSource}:{}),...(!previous.place&&item.place?{place:item.place}:{}),...(!previous.sourceId&&item.sourceId?{sourceId:item.sourceId}:{})};
  if(JSON.stringify(enriched)===JSON.stringify(previous))return current;
  const next=current.map(row=>row.id===id?enriched:row);
  storage.setItem(INTERESTS_KEY,JSON.stringify({version:1,items:next,nativeImportIds:state.nativeImportIds}));return next;
 }
 const removing=action==='remove'||(action==='toggle'&&exists);
 if(!removing&&current.length>=INTERESTS_LIMIT)throw new Error('Your Interested list holds up to 200 places. Remove one before adding another.');
 const next=removing?current.filter(row=>row.id!==id):[{...item,id,addedAt:now},...current];
 storage.setItem(INTERESTS_KEY,JSON.stringify({version:1,items:next,nativeImportIds:state.nativeImportIds}));
 return next;
}

export function editInterest(storage:Store,id:string,details:{title:string;place:string;notes:string}):Interest[]{
 const state=decode(storage.getItem(INTERESTS_KEY)),previous=state.items.find(item=>item.id===id);
 if(!previous)throw new Error('This saved choice is no longer in your Interested list.');
 const edited=cleanInput({...previous,...details,titleSource:'user',identityTitle:previous.identityTitle??previous.title,identityPlace:previous.identityPlace??previous.place});
 if(!edited)throw new Error('Check the saved name, location and notes (up to 600 characters).');
 const next=state.items.map(item=>item.id===id?{...edited,id,addedAt:previous.addedAt}:item);
 storage.setItem(INTERESTS_KEY,JSON.stringify({version:1,items:next,nativeImportIds:state.nativeImportIds}));return next;
}

export function itemForMatch(match:Match):InterestInput{
 const booking=matchedBookingPage(match);
 if(booking)return {kind:'restaurant',title:booking.name,place:booking.city,provider:booking.provider,url:booking.url,sourceId:match.source,titleSource:'provider'};
 const direct=interestUrl(match.direct);
 return {kind:match.category==='Food'?'restaurant':match.category==='Stays'?'hotel':'activity',title:match.title,place:match.place,provider:direct?'Venue website':'Place search',url:direct||'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:match.query}),sourceId:match.source,titleSource:'reel'};
}

export function itemForProviderLink(url:unknown,title=''):InterestInput|null {
 const product=providerProduct(url);
 if(!product||typeof title!=='string'||title.trim().length>240)return null;
 return {kind:product.kind,provider:product.provider,title:title.trim()||product.defaultTitle,place:'',url:product.url,titleSource:title.trim()?'user':'link'};
}

export type NativeInterestImportResult={acknowledged:string[];added:number;rejected:number;pending:number};
type ImportedInterest={id:string;originalId:string;item:InterestInput;addedAt:string};
function nativeInterest(value:unknown):ImportedInterest|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(!uuid(v.id)||typeof v.title!=='string'||!text(v.title,240)||!text(v.provider,80)||!['activity','hotel','restaurant'].includes(String(v.kind))||typeof v.addedAt!=='string'||v.addedAt.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v.addedAt)||!calendarDate(v.addedAt.slice(0,10))||!Number.isFinite(Date.parse(v.addedAt)))return null;
 // Infer classification from the URL; native/provider labels are not authority.
 const item=itemForProviderLink(v.url,v.title);
 return item&&item.kind!=='flight'?{id:v.id.toLowerCase(),originalId:v.id,item,addedAt:new Date(v.addedAt).toISOString()}:null;
}

export function importNativeInterests(storage:Store,payload:unknown):NativeInterestImportResult {
 if(!Array.isArray(payload)||payload.length>200)throw new Error('The shared places could not be read. They are still saved in the app.');
 const state=decode(storage.getItem(INTERESTS_KEY)),history=new Set(state.nativeImportIds),ids=new Set(state.items.map(row=>row.id));
 const parsed=payload.map(nativeInterest),conflicts=new Set<string>(),identities=new Map<string,string>();
 for(const entry of parsed){if(!entry)continue;const identity=interestKey(entry.item),previous=identities.get(entry.id);if(previous&&previous!==identity)conflicts.add(entry.id);identities.set(entry.id,identity);}
 const acknowledged:string[]=[],seen=new Set<string>();let added=0,rejected=0,pending=0,dirty=false;
 for(const entry of parsed){
  if(!entry||conflicts.has(entry.id)){rejected++;continue;}
  if(seen.has(entry.id))continue;seen.add(entry.id);
  if(history.has(entry.id)){acknowledged.push(entry.originalId);continue;}
  const id=interestKey(entry.item);
  if(!ids.has(id)){
   if(state.items.length>=INTERESTS_LIMIT){pending++;continue;}
   state.items.unshift({...entry.item,id,addedAt:entry.addedAt});ids.add(id);added++;
  }
  history.add(entry.id);acknowledged.push(entry.originalId);dirty=true;
 }
 // Persist the items and receipt IDs atomically. If acknowledgement is lost,
 // replay remains harmless even after a user removes a saved item.
 if(dirty)storage.setItem(INTERESTS_KEY,JSON.stringify({version:1,items:state.items,nativeImportIds:[...history].slice(-IMPORT_HISTORY_LIMIT)}));
 return {acknowledged,added,rejected,pending};
}

export function itemForGetYourGuide(url:string,title='',place=''):InterestInput|null{
 const activity=getYourGuideActivity(url);if(!activity)return null;
 const input=itemForProviderLink(getYourGuideActivityUrl(activity.url)!,title);
 return input?{...input,place}:null;
}
