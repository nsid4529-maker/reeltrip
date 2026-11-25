import {readBuckets,assignReel,BUCKETS_KEY,type ReelBucket} from './reel-buckets.ts';
import {reelID,readLibrary,LIBRARY_KEY,type Reel} from './reel-library.ts';
import {writableLibrary,writableBundles,readDeletedBundles} from './reel-import.ts';
import {ANALYSIS_KEY,readAnalysisCache} from './analysis-cache.ts';
import type {NativeBundle,NativeShare} from './native-library.ts';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const NATIVE_SHARE_RECEIPTS_KEY='reeltrip-native-share-receipts-v1';
export const NATIVE_REELS_IMPORTED='reeltrip:native-reels-imported';
export type NativeReelsImportedEvent=CustomEvent<ReturnType<typeof importNativeShares>>;
export function bundleCatalog(buckets:ReelBucket[],library:Reel[]):NativeBundle[]{return buckets.map(b=>({id:b.id,name:b.name,createdAt:b.createdAt,...(b.updatedAt?{updatedAt:b.updatedAt}:{}),urls:b.reelIds.map(id=>library.find(r=>r.id===id&&r.platform!=='Uploaded video')?.url).filter((u):u is string=>!!u)}));}
export function restoreNativeBundles(raw:unknown,library:Reel[]):ReelBucket[]{
 if(!Array.isArray(raw))return [];
 return readBuckets(JSON.stringify(raw.slice(0,20).filter(b=>uuid(b?.id)&&Array.isArray(b.urls)).map(b=>({id:b.id,name:b.name,createdAt:b.createdAt,updatedAt:b.updatedAt,reelIds:b.urls.filter((u:unknown)=>typeof u==='string').map(reelID)}))),library.map(r=>r.id));
}
// Merge by bundle id. The web copy wins unless the iPhone copy carries a newer
// edit; bundles only one side has are kept, except ones deleted on the web.
export function mergeNativeBundles(local:ReelBucket[],raw:unknown,library:Reel[],deleted:ReadonlySet<string>=new Set()):ReelBucket[]{
 const phone=restoreNativeBundles(raw,library),edited=(b:ReelBucket)=>Date.parse(b.updatedAt||b.createdAt)||0;
 const merged=local.map(b=>{const other=phone.find(p=>p.id===b.id);return other?.updatedAt&&edited(other)>edited(b)?other:b;});
 for(const b of phone)if(!merged.some(m=>m.id===b.id)&&!deleted.has(b.id))merged.push(b);
 return merged.slice(0,20);
}
export function applyNativeShares(buckets:ReelBucket[],library:Reel[],actions:NativeShare[],receipts:ReadonlySet<string>=new Set()){
 let next=buckets;const acknowledged:string[]=[],seen=new Set<string>(),messages:string[]=[],jobs:Record<string,string>={},analysisActions:Record<string,string>={},analyseIds=new Set<string>(),saveOnlyIds=new Set<string>();let individual:Reel|undefined;
 for(const action of actions.slice(0,100)){
  if(!uuid(action?.id)||seen.has(action.id.toLowerCase())||!Array.isArray(action.urls)||action.urls.length>4||action.urls.some(u=>typeof u!=='string'))continue;
  // Shares into a shared bucket are added on the server by applySharedShares; leave them queued here.
  if(action.sharedBucketId)continue;
  seen.add(action.id.toLowerCase());
  if(receipts.has(action.id.toLowerCase())){acknowledged.push(action.id);continue;}
  const reels=action.urls.map(u=>library.find(r=>r.id===reelID(u)));
  if(!reels.length||reels.some(r=>!r))continue;
  if(action.bundleId){
   try{let updated=next;for(const r of reels)updated=assignReel(updated,action.bundleId,r!.id);next=updated;}
   catch{messages.push('A shared reel could not fit its chosen bundle. It is safe in Reel Library; choose another bundle.');}
  }else if(action.openAnalysis!==false)individual=reels[0];
  // A new bundle/analyse share is an explicit request, including when the same
  // reel was previously saved without analysis or has an older failed job.
  for(const [index,r] of reels.entries()){
   if(action.bundleId||action.openAnalysis!==false){
    analyseIds.add(r!.id);saveOnlyIds.delete(r!.id);analysisActions[r!.id]=action.id.toLowerCase();
    // Native keeps the first saved URL, but a new share can use another alias.
    const job=action.jobs?.[action.urls[index]];if(uuid(job))jobs[r!.id]=job;else delete jobs[r!.id];
   }else{saveOnlyIds.add(r!.id);analyseIds.delete(r!.id);delete jobs[r!.id];delete analysisActions[r!.id];if(individual?.id===r!.id)individual=undefined;}
  }
  acknowledged.push(action.id);
 }
 // Native actions run through the global import queue. Clear an older Save only
 // opt-out without also enrolling the reel in the separate web-upload queue.
 const updatedLibrary=library.map(reel=>{if(saveOnlyIds.has(reel.id))return {...reel,autoAnalyse:false};if(!analyseIds.has(reel.id))return reel;const {autoAnalyse,...nativeReel}=reel;return nativeReel;});
 return {buckets:next,acknowledged,messages,individual,jobs,analysisActions,analyseIds:[...analyseIds],saveOnlyIds:[...saveOnlyIds],library:updatedLibrary};
}

type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type PendingAnalysis={actionId:string;jobId?:string;before:string};
type Receipts={version:1;ids:string[];pending:Record<string,PendingAnalysis>};
function readReceipts(storage:Pick<Storage,'getItem'>):Receipts{
 const raw=storage.getItem(NATIVE_SHARE_RECEIPTS_KEY),value=raw===null?[]:JSON.parse(raw);
 const record=Array.isArray(value)?{version:1,ids:value,pending:{}}:value;
 if(!record||record.version!==1||!Array.isArray(record.ids)||record.ids.length>1000||!record.ids.every(uuid)||!record.pending||typeof record.pending!=='object'||Array.isArray(record.pending)||Object.keys(record.pending).length>100||Object.entries(record.pending).some(([id,item])=>{const p=item as PendingAnalysis;return !id||id.length>512||!p||!uuid(p.actionId)||typeof p.before!=='string'||p.before.length>200||p.jobId!==undefined&&!uuid(p.jobId);}))throw new Error('The shared-reel receipts could not be read safely.');
 return {version:1,ids:record.ids.map((id:string)=>id.toLowerCase()),pending:record.pending};
}
function cacheVersion(raw:string|null,id:string):string{
 const entry=JSON.parse(raw||'{}')?.[id];
 if(!entry)return '';
 return JSON.stringify([uuid(entry.runId)?entry.runId:null,Number.isFinite(entry.updatedAt)?entry.updatedAt:null,['working','complete','excluded','error'].includes(entry.status)?entry.status:null,uuid(entry.jobId)?entry.jobId:null]);
}
export function finishNativeAnalysis(storage:Store,reelId:string,actionId:string){
 const receipts=readReceipts(storage);if(receipts.pending[reelId]?.actionId!==actionId)return;
 delete receipts.pending[reelId];storage.setItem(NATIVE_SHARE_RECEIPTS_KEY,JSON.stringify(receipts));
}
export function pendingNativeAnalyses(storage:Store,library:Reel[]){
 const receipts=readReceipts(storage),raw=storage.getItem(ANALYSIS_KEY),cache=readAnalysisCache(raw,library),requests:{reel:Reel;actionId:string;retry:boolean;seedJob?:string}[]=[];
 for(const [id,intent] of Object.entries(receipts.pending)){
  const reel=library.find(reel=>reel.id===id),saved=cache[id],unchanged=cacheVersion(raw,id)===intent.before;
  if(!reel||saved?.status==='complete'||saved?.status==='excluded'||!unchanged&&saved?.status!=='working'){finishNativeAnalysis(storage,id,intent.actionId);continue;}
  // A changed generation proves this intent already began. Resume work, but
  // never turn its later error into another automatic paid attempt.
  requests.push({reel,actionId:intent.actionId,retry:unchanged&&!intent.jobId,...(unchanged&&intent.jobId&&saved?.jobId!==intent.jobId?{seedJob:intent.jobId}:{})});
 }
 return requests;
}
export function importNativeShares(storage:Store,data:{videos:unknown;bundles?:unknown;pendingShares?:NativeShare[]},seedJobs:(jobs:Record<string,string>,library:Reel[])=>void){
 const local=writableLibrary(storage),incoming=readLibrary(JSON.stringify(data.videos));
 if(!Array.isArray(data.videos)||data.videos.length>100||incoming.length!==data.videos.length||incoming.some(reel=>reel.platform==='Uploaded video')||data.pendingShares!==undefined&&(!Array.isArray(data.pendingShares)||data.pendingShares.length>100))throw new Error('The shared library could not be read safely.');
 // Startup saves produce intermediate native snapshots. Missing rows are not
 // deletions: local removal is committed before sending the native remove.
 const library=[...incoming.map(reel=>local.find(old=>old.id===reel.id)||reel),...local.filter(reel=>!incoming.some(row=>row.id===reel.id))];
 if(library.length>100)throw new Error('The combined library is full. Existing reels remain saved.');
 const history=readReceipts(storage),receipts=new Set<string>(history.ids),actions=data.pendingShares||[];
 const buckets=mergeNativeBundles(storage.getItem(BUCKETS_KEY)===null?[]:writableBundles(storage),data.bundles,library,readDeletedBundles(storage));
 const applied=applyNativeShares(buckets,library,actions,receipts);
 for(const id of Object.keys(history.pending))if(!library.some(reel=>reel.id===id))delete history.pending[id];
 for(const id of applied.saveOnlyIds)delete history.pending[id];
 const rawCache=storage.getItem(ANALYSIS_KEY);
 for(const id of applied.analyseIds)history.pending[id]={actionId:applied.analysisActions[id],before:cacheVersion(rawCache,id),...(applied.jobs[id]?{jobId:applied.jobs[id]}:{})};
 for(const id of applied.acknowledged)receipts.add(id.toLowerCase());
 // Pin receipts still present in the native queue while bounding old history.
 const pending=new Set([...actions.filter(action=>uuid(action?.id)).map(action=>action.id.toLowerCase()),...Object.values(history.pending).map(intent=>intent.actionId)]);
 const pinned=[...receipts].filter(id=>pending.has(id)),older=[...receipts].filter(id=>!pending.has(id));
 const changes=new Map([[LIBRARY_KEY,JSON.stringify(applied.library)],[BUCKETS_KEY,JSON.stringify(applied.buckets)],[NATIVE_SHARE_RECEIPTS_KEY,JSON.stringify({version:1,ids:[...older.slice(-(1000-pinned.length)),...pinned],pending:history.pending})]]);
 const before=new Map([...changes.keys()].map(key=>[key,storage.getItem(key)])),written:string[]=[];
 try{
  for(const [key,value] of changes){
   if(key===NATIVE_SHARE_RECEIPTS_KEY)seedJobs(applied.jobs,applied.library);
   storage.setItem(key,value);written.push(key);
  }
 }catch(error){
  for(const key of written.reverse())try{const value=before.get(key);if(value===null)storage.removeItem(key);else storage.setItem(key,value!);}catch{/* Preserve the native pending action for retry. */}
  throw error;
 }
 return applied;
}

// iPhone shares into a shared bucket. The Share Extension has no member cookie,
// so the app's web view adds each reel for the group when it next opens. A share
// is acknowledged once added, or when it can never succeed (the bucket is gone,
// you left it, the link is refused, the bucket is full); offline, rate-limited
// and server errors keep it queued for the next open.
export type SharedAdd=(bucketId:string,url:string)=>Promise<{added:boolean}>;
export async function applySharedShares(actions:NativeShare[],buckets:{id:string;name:string}[],add:SharedAdd){
 const acknowledged:string[]=[],messages:string[]=[],seen=new Set<string>();let added=0;
 for(const action of actions.slice(0,100)){
  if(!action?.sharedBucketId||!uuid(action.id)||seen.has(action.id.toLowerCase())||!Array.isArray(action.urls)||action.urls.length>4||action.urls.some(u=>typeof u!=='string'))continue;
  seen.add(action.id.toLowerCase());
  const name=buckets.find(b=>b.id===action.sharedBucketId)?.name||'your shared bucket';
  if(!uuid(action.sharedBucketId)){acknowledged.push(action.id);continue;}
  let keep=false;
  for(const url of action.urls){
   try{if((await add(action.sharedBucketId,url)).added)added++;}
   catch(e){
    const status=(e as {status?:number})?.status??0;
    if(status===0||status===429||status>=500){keep=true;break;}
    messages.push(status===404?`A reel you shared couldn’t go into ${name}: the bucket was deleted or this app isn’t a member. It’s safe in your Reel Library.`:`A reel you shared couldn’t go into ${name}: ${(e as Error).message} It’s safe in your Reel Library.`);
   }
  }
  if(!keep)acknowledged.push(action.id);
 }
 if(added)messages.unshift(added===1?'Your shared reel was added for your group.':`${added} shared reels were added for your group.`);
 return {acknowledged,messages};
}
