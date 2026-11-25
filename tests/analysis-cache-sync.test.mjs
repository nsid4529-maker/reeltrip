import test from 'node:test';
import assert from 'node:assert/strict';
import {ANALYSIS_KEY,AnalysisCacheWriter,interruptedAnalysis,mergeAnalysisCache,nativeJobEntries,persistAnalysisEntry,queuedReels,readAnalysisCache} from '../lib/analysis-cache.ts';
import {addReels} from '../lib/reel-library.ts';
test('bucket agent adopts completed results from another mounted view without regressing its newer work',()=>{
 const current={a:{status:'working',updatedAt:100},b:{status:'working',updatedAt:300}};
 const incoming={a:{status:'complete',updatedAt:200},b:{status:'error',updatedAt:200},c:{status:'excluded',updatedAt:100}};
 const merged=mergeAnalysisCache(current,incoming);
 assert.equal(merged.a.status,'complete');assert.equal(merged.b.status,'working');assert.equal(merged.c.status,'excluded');
 assert.equal(current.a.status,'working');assert.equal(incoming.b.status,'error');
});
test('native jobs keep completed and excluded results, preserve active progress, and reject malformed IDs',()=>{
 const job=crypto.randomUUID(),old=crypto.randomUUID();
 const cache={done:{status:'complete',updatedAt:1},excluded:{status:'excluded',updatedAt:1},active:{status:'working',jobId:job,updatedAt:1},stale:{status:'working',jobId:old,updatedAt:1}};
 const entries=nativeJobEntries(cache,{done:job,excluded:job,active:job,stale:job,invalid:'------------------------------------'},2);
 assert.deepEqual(entries,{stale:{status:'working',jobId:job,updatedAt:2}});assert.equal(cache.stale.jobId,old);
});
test('terminal results win equal-timestamp restoration instead of regressing to working or error',()=>{
 const result={status:'complete',updatedAt:100},error={status:'error',message:'Old error',updatedAt:100};
 assert.equal(mergeAnalysisCache({reel:result},{reel:{status:'working',updatedAt:100}}).reel,result);
 assert.equal(mergeAnalysisCache({reel:result},{reel:error}).reel,result);
 assert.equal(mergeAnalysisCache({reel:error},{reel:result}).reel,result);
});
test('restored failures keep only valid resumable job IDs and do not silently expire into paid background work',()=>{
 const [reel]=addReels([],['https://www.instagram.com/reel/ResumeCache/']),jobId=crypto.randomUUID(),runId=crypto.randomUUID(),now=3*86400000;
 for(const status of ['working','error']){
  const restored=readAnalysisCache(JSON.stringify({[reel.id]:{status,message:'Retry to resume',jobId,runId,updatedAt:1}}),[reel],now);
  assert.equal(restored[reel.id].status,'error');assert.equal(restored[reel.id].jobId,jobId);assert.equal(restored[reel.id].runId,runId);assert.deepEqual(queuedReels([reel.id],[reel],restored),[]);
 }
 const malformed=readAnalysisCache(JSON.stringify({[reel.id]:{status:'error',message:'Unavailable',jobId:'------------------------------------',runId:'bad',updatedAt:now}}),[reel],now);
 assert.equal(malformed[reel.id].jobId,undefined);assert.equal(malformed[reel.id].runId,undefined);
});
test('progress survives storage roundtrips without accepting arbitrary source or stage data',()=>{
 const [reel]=addReels([],['https://www.instagram.com/reel/ProgressCache/']),jobId=crypto.randomUUID(),runId=crypto.randomUUID(),now=1000;
 const entry={status:'working',jobId,runId,updatedAt:now,clip:{status:'processing',jobId,stage:'transcribing',source:{title:'Unverified'}}};
 let restored=readAnalysisCache(JSON.stringify({[reel.id]:entry}),[reel],now);
 assert.deepEqual(restored[reel.id].clip,{status:'processing',jobId,stage:'transcribing'});
 entry.clip.stage='untrusted arbitrary stage';restored=readAnalysisCache(JSON.stringify({[reel.id]:entry}),[reel],now);assert.equal(restored[reel.id].clip.stage,undefined);
 const interrupted=readAnalysisCache(JSON.stringify({[reel.id]:{status:'working',runId,updatedAt:1}}),[reel],360002);assert.equal(interrupted[reel.id].status,'error');assert.deepEqual(queuedReels([reel.id],[reel],interrupted),[]);
});
test('late callbacks cannot overwrite a newer native or other-tab run even with a newer wall-clock time',()=>{
 let raw=JSON.stringify({other:{status:'error',message:'Keep another bucket',updatedAt:1}});const storage={getItem:key=>key===ANALYSIS_KEY?raw:null,setItem:(_key,value)=>{raw=value;}},old=crypto.randomUUID(),fresh=crypto.randomUUID();
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:old,updatedAt:2}),true);
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:old,jobId:crypto.randomUUID(),updatedAt:3},old),true);
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:fresh,jobId:crypto.randomUUID(),updatedAt:4}),true);
 for(const status of ['working','error','complete'])assert.equal(persistAnalysisEntry(storage,'reel',{status,runId:old,updatedAt:1000},old),false);
 assert.equal(JSON.parse(raw).reel.runId,fresh);assert.equal(JSON.parse(raw).other.message,'Keep another bucket');
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'complete',runId:fresh,updatedAt:5},fresh),true);
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:old,updatedAt:1}),false);
 assert.equal(JSON.parse(raw).reel.status,'complete');
});
test('a queued initial submission cannot replace a job accepted after its cache snapshot',()=>{
 let raw='{}';const storage={getItem:()=>raw,setItem:(_key,value)=>{raw=value;}},initial=crypto.randomUUID(),accepted=crypto.randomUUID();
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:accepted,jobId:crypto.randomUUID(),updatedAt:2}),true);
 // null is an explicit expectation that this reel had no generation yet.
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:initial,updatedAt:3},null),false);
 assert.equal(JSON.parse(raw).reel.runId,accepted);
 raw=JSON.stringify({reel:{status:'error',message:'Old failure',updatedAt:1}});
 assert.equal(persistAnalysisEntry(storage,'reel',{status:'working',runId:initial,updatedAt:2},null),true);
});
test('opening an abandoned starting marker becomes a visible error and stops background queuing',()=>{
 const [reel]=addReels([],['https://www.instagram.com/reel/AbandonedStart/']),runId=crypto.randomUUID(),starting={status:'working',runId,updatedAt:10};
 let raw=JSON.stringify({[reel.id]:starting});const storage={getItem:()=>raw,setItem:(_key,value)=>{raw=value;}};
 const error=interruptedAnalysis(starting,10);assert.equal(error.status,'error');assert.equal(error.runId,runId);assert.ok(error.updatedAt>starting.updatedAt);
 assert.equal(persistAnalysisEntry(storage,reel.id,error,runId),true);const restored=readAnalysisCache(raw,[reel],11);assert.deepEqual(queuedReels([reel.id],[reel],restored),[]);assert.match(restored[reel.id].message,/Retry explicitly/);
 assert.equal(interruptedAnalysis({...starting,jobId:crypto.randomUUID()}),null);assert.equal(interruptedAnalysis({status:'complete',updatedAt:10}),null);
});
test('storage quota failures retain in-memory progress and recover without treating their own generation as stale',()=>{
 const writer=new AnalysisCacheWriter(),old=crypto.randomUUID(),fresh=crypto.randomUUID();let full=true,raw=JSON.stringify({reel:{status:'error',runId:old,updatedAt:1}});
 const storage={getItem:()=>raw,setItem:(_key,value)=>{if(full)throw new DOMException('Storage full','QuotaExceededError');raw=value;}};
 assert.equal(writer.write(storage,'reel',{status:'working',runId:fresh,updatedAt:2},old),true);
 assert.equal(writer.write(storage,'reel',{status:'working',runId:fresh,jobId:crypto.randomUUID(),updatedAt:3},fresh),true);
 assert.equal(JSON.parse(raw).reel.runId,old);
 full=false;assert.equal(writer.write(storage,'reel',{status:'complete',runId:fresh,updatedAt:4},fresh),true);
 assert.equal(JSON.parse(raw).reel.runId,fresh);assert.equal(JSON.parse(raw).reel.status,'complete');
});
test('quota recovery never overwrites a different generation accepted by another view',()=>{
 const writer=new AnalysisCacheWriter(),old=crypto.randomUUID(),pending=crypto.randomUUID(),newer=crypto.randomUUID();let raw=JSON.stringify({reel:{status:'working',runId:old,updatedAt:1}}),full=true;
 const storage={getItem:()=>raw,setItem:(_key,value)=>{if(full)throw new DOMException('Storage full','QuotaExceededError');raw=value;}};
 assert.equal(writer.write(storage,'reel',{status:'working',runId:pending,updatedAt:2},old),true);
 raw=JSON.stringify({reel:{status:'working',runId:newer,jobId:crypto.randomUUID(),updatedAt:3}});full=false;
 assert.equal(writer.write(storage,'reel',{status:'complete',runId:pending,updatedAt:100},pending),false);
 assert.equal(JSON.parse(raw).reel.runId,newer);
});
