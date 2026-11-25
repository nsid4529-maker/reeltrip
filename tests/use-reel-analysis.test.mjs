import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../lib/catalog.json' with {type:'json'};
import {matches} from '../lib/travel.ts';
import {addReels} from '../lib/reel-library.ts';
import {ANALYSIS_KEY} from '../lib/analysis-cache.ts';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';

const source=catalog.find(item=>item.id==='ella'),[reel]=addReels([],[source.source_url]);
const reviewed={status:'analysis_cached',source,matches:matches.filter(item=>item.source===source.id)};
async function analysisHook(storage){
 const calls=[],globals=browserGlobals({storage});globals.fetch=async(url,options)=>{calls.push({url,method:options?.method});return new Response(JSON.stringify({clips:[reviewed]}),{status:200});};
 const h=await componentHarness('components/use-reel-analysis.ts',{globals,exportName:'useReelAnalysis'});
 return {h,calls};
}
for(const kind of ['reviewed','expired AI','invalid complete'])test('real analysis hook can replace a filtered '+kind+' cache entry',async t=>{
 const old=crypto.randomUUID(),entry={status:'complete',runId:old,updatedAt:Date.now(),clip:reviewed};
 if(kind==='expired AI'){entry.updatedAt-=2*86400000;entry.clip={...reviewed,status:'analysis_completed',source:{...source,analysis_kind:'ai'}};}
 if(kind==='invalid complete')entry.clip={status:'analysis_completed',source:{analysis_kind:'ai'}};
 const storage=memoryStorage({[ANALYSIS_KEY]:JSON.stringify({[reel.id]:entry})}),{h,calls}=await analysisHook(storage);t.after(()=>h.unmount());
 const result=await h.tree.ensure(reel);await h.flush();
 assert.equal(result.source.id,source.id);assert.deepEqual(calls,[{url:'/api/extract',method:'POST'}]);assert.equal(h.tree.cache[reel.id].status,'complete');assert.notEqual(JSON.parse(storage.getItem(ANALYSIS_KEY))[reel.id].runId,old);
 assert.equal((await h.tree.ensure(reel)).source.id,source.id);assert.equal(calls.length,1);
});
test('real hook reuses a valid completed AI analysis without a new request or cache deletion',async t=>{
 const runId=crypto.randomUUID(),clip={...reviewed,status:'analysis_completed',source:{...source,analysis_kind:'ai'}},raw=JSON.stringify({[reel.id]:{status:'complete',runId,updatedAt:Date.now(),clip}}),storage=memoryStorage({[ANALYSIS_KEY]:raw}),{h,calls}=await analysisHook(storage);t.after(()=>h.unmount());
 const result=await h.tree.ensure(reel);await h.flush();assert.equal(result.source.analysis_kind,'ai');assert.deepEqual(calls,[]);assert.equal(storage.getItem(ANALYSIS_KEY),raw);assert.equal(h.tree.cache[reel.id].runId,runId);
});
test('real hook can seed a native job over a filtered completed record without submitting it again',async t=>{
 const storage=memoryStorage({[ANALYSIS_KEY]:JSON.stringify({[reel.id]:{status:'complete',runId:crypto.randomUUID(),updatedAt:Date.now(),clip:reviewed}})}),{h,calls}=await analysisHook(storage);t.after(()=>h.unmount());
 const jobId=crypto.randomUUID();h.tree.restore([reel]);h.tree.seedJobs({[reel.id]:jobId});await h.flush();
 assert.equal(h.tree.cache[reel.id].status,'working');assert.equal(h.tree.cache[reel.id].jobId,jobId);
 assert.equal((await h.tree.ensure(reel)).source.id,source.id);assert.deepEqual(calls,[{url:'/api/extract?job='+jobId,method:undefined}]);
});
test('real hook rejects a new native generation arriving after ignored-cache restoration',async t=>{
 const old=crypto.randomUUID(),fresh=crypto.randomUUID(),storage=memoryStorage({[ANALYSIS_KEY]:JSON.stringify({[reel.id]:{status:'complete',runId:old,updatedAt:Date.now(),clip:reviewed}})}),{h,calls}=await analysisHook(storage);t.after(()=>h.unmount());
 const request=h.tree.ensure(reel);
 storage.setItem(ANALYSIS_KEY,JSON.stringify({[reel.id]:{status:'working',runId:fresh,jobId:crypto.randomUUID(),updatedAt:Date.now()}}));
 await assert.rejects(request,{name:'AbortError'});assert.deepEqual(calls,[]);assert.equal(JSON.parse(storage.getItem(ANALYSIS_KEY))[reel.id].runId,fresh);
});
