import {addReels,addUploadedReel,readLibrary,reelID,LIBRARY_KEY,type Reel} from './reel-library.ts';
import {assignReel,readBuckets,BUCKETS_KEY,type ReelBucket} from './reel-buckets.ts';
import {loadTrips,updateTrip} from './trip-buckets.ts';

export type ReelDestination={kind:'individual'}|{kind:'bundle'|'trip';id:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function writableLibrary(storage:Pick<Storage,'getItem'>):Reel[]{
 const raw=storage.getItem(LIBRARY_KEY);if(raw===null)return [];
 try{const rows=JSON.parse(raw),reels=readLibrary(raw);if(!Array.isArray(rows)||rows.length!==reels.length||rows.length>100)throw new Error();return reels;}
 catch{throw new Error('Your Reel Library could not be read safely. Its existing data has been kept unchanged.');}
}
export function writableBundles(storage:Pick<Storage,'getItem'>):ReelBucket[]{
 const raw=storage.getItem(BUCKETS_KEY);if(raw===null)return [];
 try{const rows=JSON.parse(raw),bundles=readBuckets(raw);if(!Array.isArray(rows)||rows.length!==bundles.length||rows.some((row:ReelBucket,index:number)=>row.reelIds.length!==bundles[index].reelIds.length))throw new Error();return bundles;}
 catch{throw new Error('Your bundles could not be read safely. Their existing data has been kept unchanged.');}
}
// Bundles deleted on the web, so a stale iPhone copy cannot bring them back.
export const BUNDLE_DELETIONS_KEY='reeltrip-bundle-deletions-v1';
export function readDeletedBundles(storage:Pick<Storage,'getItem'>):Set<string>{
 try{const value=JSON.parse(storage.getItem(BUNDLE_DELETIONS_KEY)||'{}');return new Set(value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).filter(id=>id.length<=100):[]);}
 catch{return new Set();}
}
function rememberDeletedBundles(storage:Store,ids:string[]){
 if(!ids.length)return;
 let saved:Record<string,string>={};try{const value=JSON.parse(storage.getItem(BUNDLE_DELETIONS_KEY)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
 const now=new Date().toISOString();for(const id of ids)saved[id]=now;
 const newest=Object.entries(saved).filter(([,when])=>typeof when==='string').sort((a,b)=>b[1].localeCompare(a[1])).slice(0,100);
 storage.setItem(BUNDLE_DELETIONS_KEY,JSON.stringify(Object.fromEntries(newest)));
}
// Mutations receive the latest saved membership, never a rendered tab snapshot.
export function updateBundles(storage:Store,change:(current:ReelBucket[])=>ReelBucket[]):ReelBucket[]{
 const before=writableBundles(storage),now=new Date().toISOString();
 const content=(b:ReelBucket)=>JSON.stringify([b.name,b.reelIds]);
 // Stamp every bundle this change touched, so the iPhone merge keeps the newer copy.
 const next=change(before).map(b=>{const old=before.find(o=>o.id===b.id);return old&&content(old)===content(b)?b:{...b,updatedAt:now};}),raw=JSON.stringify(next);
 writableBundles({getItem:()=>raw});
 storage.setItem(BUCKETS_KEY,raw);
 try{rememberDeletedBundles(storage,before.filter(b=>!next.some(n=>n.id===b.id)).map(b=>b.id));}catch{/* The deletion itself is saved; only the stale-copy guard is lost. */}
 return next;
}
function commitChanges(storage:Store,changed:Map<string,string>,failure:string,interrupted:string){
 const before=new Map<string,string|null>();
 for(const key of changed.keys())before.set(key,storage.getItem(key));
 const written:string[]=[];
 try{for(const [key,value] of changed){storage.setItem(key,value);written.push(key);}}
 catch{
  let restored=true;
  for(const key of written.reverse())try{
   // Do not roll back another tab's later write while compensating for ours.
   if(storage.getItem(key)!==changed.get(key)){restored=false;continue;}
   const value=before.get(key);if(value===null)storage.removeItem(key);else storage.setItem(key,value!);
  }catch{restored=false;}
  throw new Error(restored?failure:interrupted);
 }
}
export function removeSavedReel(storage:Store,reelId:string){
 const library=writableLibrary(storage).filter(reel=>reel.id!==reelId);
 const buckets=writableBundles(storage).map(bundle=>({...bundle,reelIds:bundle.reelIds.filter(id=>id!==reelId)}));
 commitChanges(storage,new Map([[BUCKETS_KEY,JSON.stringify(buckets)],[LIBRARY_KEY,JSON.stringify(library)]]),
  'This reel could not be removed. Your saved reels and bundle memberships have been kept. Please try again.',
  'Removal was interrupted and could not be fully restored. Reopen Reel Library and check its bundles before retrying.');
 return {library,buckets};
}
export function saveImportedReel(storage:Store,input:string|Reel,destination:ReelDestination,analyse:boolean){
 const library=writableLibrary(storage),withReel=typeof input==='string'?addReels(library,[input]):addUploadedReel(library,input),id=typeof input==='string'?reelID(addReels([],[input])[0].url):input.id;
 const next=withReel.map(reel=>reel.id===id?{...reel,autoAnalyse:analyse}:reel),reel=next.find(row=>row.id===id)!;
 const changed=new Map<string,string>([[LIBRARY_KEY,JSON.stringify(next)]]);
 const staged={getItem:(key:string)=>changed.get(key)??storage.getItem(key),setItem:(key:string,value:string)=>{changed.set(key,value);}};
 if(destination.kind==='bundle')changed.set(BUCKETS_KEY,JSON.stringify(assignReel(writableBundles(storage),destination.id,reel.id)));
 if(destination.kind==='trip'){
  const trip=loadTrips(storage).trips.find(trip=>trip.id===destination.id);if(!trip)throw new Error('Choose an existing bucket before saving.');
  updateTrip(staged,trip.id,{reelIds:[...new Set([...trip.reelIds,reel.id])]});
 }
 commitChanges(storage,changed,'This reel could not be saved on this device. Free some browser storage and try again.',
  'Saving was interrupted. Check Reel Library before retrying; your existing sources have not been deliberately removed.');
 return {reel,library:next,changed:[...changed.keys()]};
}
