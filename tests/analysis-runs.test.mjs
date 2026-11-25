import test from 'node:test';
import assert from 'node:assert/strict';
import {AnalysisRuns} from '../lib/analysis-runs.ts';
import {ANALYSIS_KEY,persistAnalysisEntry,readAnalysisCache} from '../lib/analysis-cache.ts';
import {addReels} from '../lib/reel-library.ts';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
for(const lateResult of ['success','failure'])test('a replacement native job survives old '+lateResult+' and cleanup',async()=>{
 const runs=new AnalysisRuns(),old=deferred(),fresh=deferred(),cache=[];let oldSignal,starts=0;
 const first=runs.run('reel',async(controller,current)=>{
  oldSignal=controller.signal;
  try{await old.promise;if(current())cache.push('old result');}catch{if(current())cache.push('old error');}
 });
 await Promise.resolve();runs.supersede('reel');assert.equal(oldSignal.aborted,true);
 const replacement=runs.run('reel',async(controller,current)=>{starts++;await fresh.promise;if(current())cache.push('new result');});
 const repeated=runs.run('reel',async()=>{throw Error('Must reuse active request');});assert.equal(repeated,replacement);
 if(lateResult==='success')old.resolve();else old.reject(Error('Late failure'));
 await assert.rejects(first,{name:'AbortError'});assert.deepEqual(cache,[]);assert.equal(runs.get('reel'),replacement);
 fresh.resolve();await replacement;assert.deepEqual(cache,['new result']);assert.equal(starts,1);assert.equal(runs.get('reel'),undefined);
});
test('disposing a view aborts its active reel work and prevents later cache writes',async()=>{
 const runs=new AnalysisRuns(),gate=deferred(),signals=[],cache=[];
 const tasks=['one','two'].map(id=>runs.run(id,async(controller,current)=>{signals.push(controller.signal);await gate.promise;if(current())cache.push(id);}));
 await Promise.resolve();runs.abortAll();assert.ok(signals.every(signal=>signal.aborted));gate.resolve();for(const task of tasks)await assert.rejects(task,{name:'AbortError'});assert.deepEqual(cache,[]);
});
test('superseding before dispatch does not start a stale request',async()=>{
 const runs=new AnalysisRuns();let calls=0;
 const stale=runs.run('reel',async()=>{calls++;});runs.supersede('reel');
 await assert.rejects(stale,{name:'AbortError'});assert.equal(calls,0);
});
test('upload and planner share a request; leaving one view does not abort the remaining subscriber',async()=>{
 const runs=new AnalysisRuns(),upload={},planner={},gate=deferred();let starts=0,signal;
 const first=runs.run('reel',async(controller)=>{starts++;signal=controller.signal;await gate.promise;return 'completed';},upload,'generation-a');
 const second=runs.run('reel',async()=>{throw Error('Duplicate submission');},planner,'generation-b');
 assert.equal(first,second);assert.equal(runs.version('reel'),'generation-a');await Promise.resolve();
 runs.release(upload);assert.equal(signal.aborted,false);assert.equal(starts,1);gate.resolve();assert.equal(await second,'completed');
});
test('joining by get retains ownership and leaving the final view aborts only its requests',async()=>{
 const runs=new AnalysisRuns(),a={},b={},gate=deferred(),other=deferred();let signal,otherSignal;
 const first=runs.run('reel',async(controller)=>{signal=controller.signal;await gate.promise;return 'stale';},a);
 assert.equal(runs.get('reel',b),first);
 const independent=runs.run('other',async(controller)=>{otherSignal=controller.signal;await other.promise;return 'other result';},a);
 await Promise.resolve();runs.release(b);assert.equal(signal.aborted,false);runs.release(a);assert.equal(signal.aborted,true);assert.equal(otherSignal.aborted,true);
 gate.resolve();other.resolve();await assert.rejects(first,{name:'AbortError'});await assert.rejects(independent,{name:'AbortError'});
});
test('a late stale result cannot resolve into a caller even when its worker ignores cancellation',async()=>{
 const runs=new AnalysisRuns(),gate=deferred();
 const stale=runs.run('reel',async()=>{await gate.promise;return 'old completed data';});await Promise.resolve();runs.supersede('reel');
 const fresh=runs.run('reel',async()=> 'new completed data');gate.resolve();await assert.rejects(stale,{name:'AbortError'});assert.equal(await fresh,'new completed data');
});
test('two immediate consumers can restore an old failure and join its replacement before dispatch',async()=>{
 const [reel]=addReels([],['https://www.instagram.com/reel/ImmediateRetry/']),runs=new AnalysisRuns(),gate=deferred(),old=crypto.randomUUID(),fresh=crypto.randomUUID();
 let raw=JSON.stringify({[reel.id]:{status:'error',message:'Previous timeout',runId:old,jobId:crypto.randomUUID(),updatedAt:1}}),starts=0;
 const storage={getItem:key=>key===ANALYSIS_KEY?raw:null,setItem:(_key,value)=>{raw=value;}};
 const request=runs.run(reel.id,async()=>{assert.equal(persistAnalysisEntry(storage,reel.id,{status:'working',runId:fresh,updatedAt:2},old),true);starts++;await gate.promise;return 'fresh result';},{},fresh);
 const restored=readAnalysisCache(raw,[reel]);assert.equal(restored[reel.id].runId,old);assert.equal(runs.activeVersion(reel.id),undefined);
 // A cache notification before dispatch still describes the prior attempt.
 if(runs.activeVersion(reel.id)&&restored[reel.id].runId!==runs.activeVersion(reel.id))runs.supersede(reel.id);
 assert.equal(runs.run(reel.id,async()=>{throw Error('Duplicate retry');},{},crypto.randomUUID()),request);
 await Promise.resolve();assert.equal(runs.activeVersion(reel.id),fresh);gate.resolve();assert.equal(await request,'fresh result');assert.equal(starts,1);
});
