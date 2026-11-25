import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';
import {addReels,LIBRARY_KEY,readLibrary} from '../lib/reel-library.ts';
import {BUCKETS_KEY,readBuckets} from '../lib/reel-buckets.ts';
import {ANALYSIS_KEY,nativeJobEntries,readAnalysisCache} from '../lib/analysis-cache.ts';
import {NATIVE_REELS_IMPORTED,NATIVE_SHARE_RECEIPTS_KEY} from '../lib/native-share.ts';
const [reel]=addReels([],['https://www.instagram.com/reel/NativeAllPages/']);
const payload=(action,extras={})=>({videos:[reel],pendingShares:[action],...extras});
const share=(extra={})=>({id:crypto.randomUUID(),urls:[reel.url],openAnalysis:false,...extra});
async function setup({storage=memoryStorage(),bridge=()=>{},background}={}){
 const globals=browserGlobals({storage}),calls=[],applied=[];globals.window.location.pathname='/trips';
 const bg=background||{cache:{},restore(reels){this.cache=readAnalysisCache(storage.getItem(ANALYSIS_KEY),reels);},seedJobs(jobs){const entries=nativeJobEntries(this.cache,jobs);this.cache={...this.cache,...entries};storage.setItem(ANALYSIS_KEY,JSON.stringify(this.cache));},ensure:async(saved,retry)=>{calls.push({id:saved.id,retry,job:JSON.parse(storage.getItem(ANALYSIS_KEY)||'{}')[saved.id]?.jobId});storage.setItem(ANALYSIS_KEY,JSON.stringify({[saved.id]:{status:'error',message:'Offline after accepted attempt',runId:crypto.randomUUID(),updatedAt:Date.now()}}));throw Error('Offline');}};
 globals.window.addEventListener(NATIVE_REELS_IMPORTED,event=>applied.push(event.detail));
 const sources=await componentHarness('components/use-trip-sources.ts',{globals,exportName:'useTripSources'});
 const h=await componentHarness('components/native-reels.tsx',{globals,modules:{'@/components/use-reel-analysis':{useReelAnalysis:()=>bg},'@/lib/native-library':{nativeLibrary:message=>{bridge(message);return true;},nativeLibraryError:()=>null}}});
 return {h,sources,globals,storage,calls,applied,send(data){globals.window.dispatchEvent(new CustomEvent('reeltrip-native-library',{detail:data}));},async flush(){await h.flush();await sources.flush();},close(){h.unmount();sources.unmount();}};
}
test('native Save only imports on a bucket page before acknowledgement without starting analysis',async t=>{
 const storage=memoryStorage(),action=share(),acks=[],s=await setup({storage,bridge:message=>{if(message.action==='acknowledge'){assert.equal(readLibrary(storage.getItem(LIBRARY_KEY)).length,1);assert.ok(JSON.parse(storage.getItem(NATIVE_SHARE_RECEIPTS_KEY)).ids.includes(action.id));acks.push(...message.ids);}}});t.after(s.close);
 s.send(payload(action));await s.flush();assert.equal(s.sources.tree.reels.length,1);assert.equal(s.sources.tree.reels[0].autoAnalyse,false);assert.deepEqual(acks,[action.id]);assert.deepEqual(s.calls,[]);assert.equal(s.applied.length,1);assert.equal(s.applied[0].individual,undefined);
});
test('native bundle share resumes its accepted job and replay does not retry its later failure',async t=>{
 const bundleId=crypto.randomUUID(),job=crypto.randomUUID(),action=share({bundleId,jobs:{[reel.url]:job}}),data=payload(action,{bundles:[{id:bundleId,name:'Food ideas',urls:[],createdAt:new Date().toISOString()}]}),s=await setup();t.after(s.close);
 s.send(data);await s.flush();assert.deepEqual(readBuckets(s.storage.getItem(BUCKETS_KEY))[0].reelIds,[reel.id]);assert.deepEqual(s.calls,[{id:reel.id,retry:false,job}]);assert.equal(s.applied[0].individual,undefined);
 s.send(data);await s.flush();assert.equal(s.calls.length,1);
});
test('fresh Analyse share broadcasts individual auto-open, retries once, and survives lost acknowledgement',async t=>{
 const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify([reel]),[ANALYSIS_KEY]:JSON.stringify({[reel.id]:{status:'error',message:'Old failure',updatedAt:1}})}),action=share({openAnalysis:true}),s=await setup({storage,bridge:message=>{if(message.action==='acknowledge')throw Error('Disconnected');}});t.after(s.close);
 s.send(payload(action));await s.flush();assert.deepEqual(s.calls,[{id:reel.id,retry:true,job:undefined}]);assert.equal(s.applied[0].individual.id,reel.id);assert.match(s.h.text(),/saved here/);
 s.send(payload(action));await s.flush();assert.equal(s.calls.length,1);assert.equal(s.applied[1].individual,undefined);
});
test('a failed local import leaves native action unacknowledged and does not launch analysis',async t=>{
 const storage=memoryStorage(),acks=[],s=await setup({storage,bridge:message=>{if(message.action==='acknowledge')acks.push(message);}});t.after(s.close);
 storage.setItem=()=>{throw Error('Quota');};s.send(payload(share({openAnalysis:true})));await s.flush();assert.deepEqual(s.calls,[]);assert.deepEqual(acks,[]);assert.equal(storage.getItem(LIBRARY_KEY),null);assert.match(s.h.text(),/still saved in the iPhone app/);
});
test('startup bridge failure keeps receiver and cleanup functional',async t=>{
 let broken=true;const s=await setup({bridge:()=>{if(broken)throw Error('Bridge unavailable');}});t.after(s.close);assert.match(s.h.text(),/saved reels have been kept/);
 broken=false;s.send(payload(share()));await s.flush();assert.equal(s.sources.tree.reels.length,1);const count=s.applied.length;s.h.unmount();s.send(payload(share()));await s.flush();assert.equal(s.applied.length,count);
});
test('synchronous native response imports before resume and nested acknowledgements do not loop',async t=>{
 const storage=memoryStorage(),globals=browserGlobals({storage}),calls=[],action=share(),data=payload(action);let acks=0;
 const bg={cache:{},restore(){},seedJobs(){},ensure:async()=>{calls.push('analysis');return {status:'not_travel'};}};
 const h=await componentHarness('components/native-reels.tsx',{globals,modules:{'@/components/use-reel-analysis':{useReelAnalysis:()=>bg},'@/lib/native-library':{nativeLibrary:message=>{if(message.action==='library'||message.action==='acknowledge'){if(message.action==='acknowledge')acks++;globals.window.dispatchEvent(new CustomEvent('reeltrip-native-library',{detail:data}));}return true;},nativeLibraryError:()=>null}}});t.after(()=>h.unmount());await h.flush();
 assert.equal(readLibrary(storage.getItem(LIBRARY_KEY)).length,1);assert.equal(acks,1);assert.deepEqual(calls,[]);
});
