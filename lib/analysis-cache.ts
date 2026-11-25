import {validateAnalysis,type ExtractClip} from './analysis.ts';
import type {Reel} from './reel-library.ts';
export const ANALYSIS_KEY='reeltrip-analysis-v4';
export type AnalysisEntry={status:'working'|'complete'|'excluded'|'error';clip?:ExtractClip;message?:string;jobId?:string;runId?:string;updatedAt:number};
export type AnalysisCache=Record<string,AnalysisEntry>;
export type AnalysisRevision={runId:string|null;updatedAt:number};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// A result can be expired or unreadable while its stored generation still
// exists. Retain that revision separately from results safe to display.
export function readAnalysisRevisions(raw:string|null,library:Reel[]):Record<string,AnalysisRevision>{
 let values:Record<string,AnalysisEntry>={};try{const parsed=JSON.parse(raw||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))values=parsed;}catch{}
 return Object.fromEntries(library.map(reel=>{const saved=values[reel.id];return [reel.id,{runId:uuid(saved?.runId)?saved.runId:null,updatedAt:Number.isFinite(saved?.updatedAt)?saved.updatedAt:0}];}));
}
export function nativeJobEntries(cache:AnalysisCache,jobs:Record<string,string>,now=Date.now()):AnalysisCache{
 const entries:AnalysisCache={};
 for(const [id,jobId] of Object.entries(jobs)){
  const saved=cache[id];
  if(!uuid(jobId)||saved?.status==='complete'||saved?.status==='excluded'||saved?.status==='working'&&saved.jobId===jobId)continue;
  entries[id]={status:'working',jobId,updatedAt:Math.max(now,(saved?.updatedAt||0)+1)};
 }
 return entries;
}
export function mergeAnalysisCache(current:AnalysisCache,incoming:AnalysisCache):AnalysisCache{
 const next={...current};
 const rank=(entry:AnalysisEntry)=>entry.status==='working'?0:entry.status==='error'?1:2;
 for(const [id,entry] of Object.entries(incoming))if(!next[id]||entry.updatedAt>next[id].updatedAt||entry.updatedAt===next[id].updatedAt&&rank(entry)>=rank(next[id]))next[id]=entry;
 return next;
}
export function readAnalysisCache(raw:string|null,library:Reel[],now=Date.now()):AnalysisCache{
 const result:AnalysisCache={};try{const values=JSON.parse(raw||'{}');
 if(!values||typeof values!=='object'||Array.isArray(values))return result;
 for(const reel of library){const item=values[reel.id] as AnalysisEntry;if(!item||!Number.isFinite(item.updatedAt))continue;
 const expired=now-item.updatedAt>86400000,runId=uuid(item.runId)?{runId:item.runId}:{},jobId=uuid(item.jobId)?{jobId:item.jobId}:{};
 if(expired&&['complete','excluded'].includes(item.status)&&reel.platform!=='Uploaded video')continue;
 if(item.status==='complete'&&item.clip?.source?.analysis_kind==='ai'){try{const checked=validateAnalysis(item.clip,reel.url);result[reel.id]={status:'complete',...runId,...jobId,updatedAt:item.updatedAt,clip:{...checked,status:'analysis_completed'}};}catch{} }
 else if(item.status==='excluded'&&item.clip&&['not_travel','reference_reviewed'].includes(item.clip.status)){
  const message=typeof item.clip.message==='string'?item.clip.message.slice(0,1000):'This reel has no travel breakdown.';
  result[reel.id]={status:'excluded',clip:{status:item.clip.status,message},message,...runId,updatedAt:item.updatedAt};
 }
 else if(item.status==='working'){
  // A missing/expired job is a stopped attempt, not permission to submit again
  // from a background queue. Keep it visible until the user explicitly retries.
  if(expired||!jobId.jobId&&(!runId.runId||now-item.updatedAt>360000))result[reel.id]={status:'error',message:'This analysis was interrupted. Open the reel and retry to check its progress.',...jobId,...runId,updatedAt:item.updatedAt};
  else{
   const progress=item.clip&&['queued','processing'].includes(item.clip.status)?{clip:{status:item.clip.status,jobId:jobId.jobId,...(['queued','acquiring','sampling','transcribing','analysing'].includes(item.clip.stage||'')?{stage:item.clip.stage}:{})}}:{};
   result[reel.id]={status:'working',...jobId,...runId,...progress,updatedAt:item.updatedAt};
  }
 }
 else if(item.status==='error'&&typeof item.message==='string')result[reel.id]={status:'error',message:item.message.slice(0,1000),...jobId,...runId,updatedAt:item.updatedAt};
 }
 }catch{}return result;
}
export function queuedReels(ids:string[],library:Reel[],cache:AnalysisCache):Reel[]{return [...new Set(ids)].map(id=>library.find(r=>r.id===id)).filter((r):r is Reel=>!!r&&r.autoAnalyse!==false&&(!cache[r.id]||cache[r.id].status==='working'));}
// Call only after checking that no mounted view owns this request. A saved
// starting marker without a job cannot be resumed by polling.
export function interruptedAnalysis(entry:AnalysisEntry|undefined,now=Date.now()):AnalysisEntry|null{
 if(entry?.status!=='working'||uuid(entry.jobId))return null;
 return {status:'error',message:'This analysis was interrupted before its job was saved. Retry explicitly to check again.',...(uuid(entry.runId)?{runId:entry.runId}:{}),updatedAt:Math.max(now,entry.updatedAt+1)};
}

// Several screens restore only the reels they need. Updating one reel must not
// overwrite cached results owned by a different trip or a second open tab.
export function persistAnalysisEntry(storage:Pick<Storage,'getItem'|'setItem'>,id:string,entry:AnalysisEntry,expectedRunId?:string|null):boolean{
 const raw=storage.getItem(ANALYSIS_KEY),current:unknown=raw===null?{}:JSON.parse(raw);
 if(!current||typeof current!=='object'||Array.isArray(current))throw new Error('Existing analysis cache could not be read.');
 const saved=(current as AnalysisCache)[id];
 if(expectedRunId!==undefined&&(uuid(saved?.runId)?saved.runId:null)!==expectedRunId||saved?.updatedAt>entry.updatedAt)return false;
 storage.setItem(ANALYSIS_KEY,JSON.stringify({...current,[id]:entry}));
 return true;
}

// A quota failure leaves the previous generation on disk. Later progress must
// compare against that generation, while still rejecting a newer disk writer.
export class AnalysisCacheWriter{
 private unsaved=new Map<string,{runId:string|null;persistedRunId:string|null}>();
 write(storage:Pick<Storage,'getItem'|'setItem'>,id:string,entry:AnalysisEntry,expectedRunId:string|null):boolean{
  const pending=this.unsaved.get(id),persistedRunId=pending?.runId===expectedRunId?pending.persistedRunId:expectedRunId;
  try{
   const accepted=persistAnalysisEntry(storage,id,entry,persistedRunId);
   this.unsaved.delete(id);return accepted;
  }catch{
   // The caller keeps the result in memory; unreadable stored data is untouched.
   this.unsaved.set(id,{runId:entry.runId||null,persistedRunId});return true;
  }
 }
}
