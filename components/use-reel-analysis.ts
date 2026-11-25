import {useCallback,useEffect,useRef,useState} from 'react';
import {analyseReelURL,type Reel} from '@/lib/reel-library';
import type {ExtractClip} from '@/lib/analysis';
import {ANALYSIS_KEY,AnalysisCacheWriter,readAnalysisCache,readAnalysisRevisions,mergeAnalysisCache,nativeJobEntries,interruptedAnalysis,type AnalysisCache,type AnalysisEntry,type AnalysisRevision} from '@/lib/analysis-cache';
import {AnalysisRuns} from '@/lib/analysis-runs';
// The upload dialog, reel page and bucket planner share one request per reel.
// This registry is used only by client callbacks; it holds no server user state.
const running=new AnalysisRuns<ExtractClip>();
export function useReelAnalysis(){
 const [cache,setCache]=useState<AnalysisCache>({});const values=useRef<AnalysisCache>({}),revisions=useRef<Record<string,AnalysisRevision>>({}),owner=useRef({}),mounted=useRef(true),known=useRef(new Map<string,Reel>()),writer=useRef(new AnalysisCacheWriter());
 const put=useCallback((id:string,entry:AnalysisEntry,expectedRunId?:string|null,persistedRunId?:string|null)=>{
  if(expectedRunId!==undefined&&(values.current[id]?.runId||null)!==expectedRunId)return false;
  try{if(!writer.current.write(localStorage,id,entry,persistedRunId!==undefined?persistedRunId:expectedRunId===undefined?values.current[id]?.runId||null:expectedRunId))return false;}catch{/* The storage property itself may be blocked. Keep this view's result. */}
  const next={...values.current,[id]:entry};values.current=next;if(mounted.current)setCache(next);
  window.dispatchEvent(new Event('reeltrip:analysis-changed'));return true;
 },[]);
 const restore=useCallback((library:Reel[])=>{
  for(const reel of library)known.current.set(reel.id,reel);
  try{
   const raw=localStorage.getItem(ANALYSIS_KEY),incoming=readAnalysisCache(raw,library),next=mergeAnalysisCache(values.current,incoming);
   Object.assign(revisions.current,readAnalysisRevisions(raw,library));
   for(const [id,entry] of Object.entries(incoming))if(next[id]===entry&&running.activeVersion(id)&&entry.runId&&entry.runId!==running.activeVersion(id))running.supersede(id);
   values.current=next;if(mounted.current)setCache(next);
  }catch{}
 },[]);
 const seedJobs=useCallback((jobs:Record<string,string>)=>{for(const [id,entry] of Object.entries(nativeJobEntries(values.current,jobs))){running.supersede(id);put(id,{...entry,updatedAt:Math.max(entry.updatedAt,(revisions.current[id]?.updatedAt||0)+1),runId:crypto.randomUUID()},values.current[id]?.runId||null,revisions.current[id]?.runId||null);}},[put]);
 const ensure=useCallback((reel:Reel,retry=false,forceRefresh=false):Promise<ExtractClip>=>{
  // Read before acting even if this view has not run its restoration effect.
  restore([reel]);const existing=running.get(reel.id,owner.current);if(existing)return existing;
  const saved=values.current[reel.id];if(!forceRefresh&&(saved?.status==='complete'||saved?.status==='excluded')&&saved.clip)return Promise.resolve(saved.clip);
  if(saved?.status==='error'&&!retry)return Promise.reject(new Error(saved.message));
  const interrupted=!retry?interruptedAnalysis(saved):null;
  if(interrupted){put(reel.id,interrupted,saved?.runId||null);return Promise.reject(new Error(interrupted.message));}
  const revision=revisions.current[reel.id],runId=crypto.randomUUID(),stamp=()=>Math.max(Date.now(),(values.current[reel.id]?.updatedAt||0)+1,(revision?.updatedAt||0)+1);
  return running.run(reel.id,(controller,isCurrent)=>{
  const write=(entry:Omit<AnalysisEntry,'updatedAt'|'runId'>,initial=false)=>{
   if(!isCurrent())throw new DOMException('A newer analysis replaced this request.','AbortError');
   if(!put(reel.id,{...entry,runId,updatedAt:stamp()},initial?saved?.runId||null:runId,initial?revision?.runId||null:undefined)){running.supersede(reel.id);throw new DOMException('A newer analysis replaced this request.','AbortError');}
  };
  write({status:'working',jobId:saved?.jobId},true);const timer=setTimeout(()=>controller.abort(),360000);
  return analyseReelURL(reel.url,controller.signal,clip=>write({status:'working',clip,jobId:clip.jobId||values.current[reel.id]?.jobId}),fetch,5000,saved?.jobId,retry).then(clip=>{
   if(!isCurrent())throw new DOMException('A newer analysis replaced this request.','AbortError');
   if(['not_travel','reference_reviewed'].includes(clip.status)){write({status:'excluded',clip,message:clip.message});return clip;}
   if(!['analysis_cached','analysis_completed'].includes(clip.status))throw new Error(clip.message||'This reel has no travel breakdown yet.');
   write({status:'complete',clip});return clip;
  }).catch(error=>{if(isCurrent())write({status:'error',jobId:values.current[reel.id]?.jobId,message:controller.signal.aborted?'Analysis is still taking time. Retry to resume.':error.message});throw error;}).finally(()=>{clearTimeout(timer);});
  },owner.current,runId);
 },[put,restore]);
 useEffect(()=>{
  mounted.current=true;const refresh=()=>restore([...known.current.values()]),storage=(event:StorageEvent)=>{if(event.key===null||event.key===ANALYSIS_KEY)refresh();};
  window.addEventListener('reeltrip:analysis-changed',refresh);window.addEventListener('storage',storage);window.addEventListener('focus',refresh);
  return()=>{mounted.current=false;running.release(owner.current);window.removeEventListener('reeltrip:analysis-changed',refresh);window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);};
 },[restore]);
 return {cache,ensure,restore,seedJobs};
}
