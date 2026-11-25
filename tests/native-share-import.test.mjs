import test from 'node:test';
import assert from 'node:assert/strict';
import {addReels,LIBRARY_KEY} from '../lib/reel-library.ts';
import {createBucket,BUCKETS_KEY} from '../lib/reel-buckets.ts';
import {applyNativeShares,importNativeShares,pendingNativeAnalyses,finishNativeAnalysis,NATIVE_SHARE_RECEIPTS_KEY} from '../lib/native-share.ts';
import {ANALYSIS_KEY} from '../lib/analysis-cache.ts';
import {memoryStorage} from './helpers/component-harness.mjs';
const reel=addReels([],['https://www.instagram.com/reel/AliasBug/'])[0],alias='https://www.instagram.com/p/AliasBug/';
const action=(extra={})=>({id:crypto.randomUUID(),urls:[alias],openAnalysis:true,...extra});
const native=(actions=[],videos=[reel])=>({videos:videos.map(({url,addedAt})=>({url,addedAt})),pendingShares:actions});

test('native aliases retain the accepted job instead of submitting another analysis',()=>{
 const job=crypto.randomUUID(),request=action({jobs:{[alias]:job}}),result=applyNativeShares([], [reel], [request]);
 assert.equal(result.jobs[reel.id],job);assert.equal(result.individual.url,reel.url);
});
test('a newer explicit share without an accepted job clears the earlier job in its batch',()=>{
 const result=applyNativeShares([], [reel], [action({jobs:{[alias]:crypto.randomUUID()}}),action()]);
 assert.deepEqual(result.jobs,{});assert.deepEqual(result.analyseIds,[reel.id]);
});
test('latest native Save only suppresses an old queue intent without deleting source data',()=>{
 const result=applyNativeShares([], [{...reel,autoAnalyse:true}], [action(),action({openAnalysis:false})]);
 assert.equal(result.library[0].autoAnalyse,false);assert.deepEqual(result.analyseIds,[]);assert.deepEqual(result.jobs,{});assert.equal(result.individual,undefined);
 const resume=applyNativeShares([],result.library,[action()]);assert.equal(resume.library[0].autoAnalyse,undefined);assert.deepEqual(resume.analyseIds,[reel.id]);
});
test('acknowledgement loss and remount replay neither reopen analysis nor replace a failed job',()=>{
 const storage=memoryStorage(),job=crypto.randomUUID(),request=action({jobs:{[alias]:job}}),seeded=[];
 const first=importNativeShares(storage,native([request]),jobs=>seeded.push(jobs));
 assert.deepEqual(first.analyseIds,[reel.id]);assert.equal(seeded[0][reel.id],job);
 const replay=importNativeShares(storage,native([{...request,id:request.id.toUpperCase()}]),jobs=>seeded.push(jobs));
 assert.deepEqual(replay.jobs,{});assert.deepEqual(replay.analyseIds,[]);assert.equal(replay.individual,undefined);assert.deepEqual(replay.acknowledged,[request.id.toUpperCase()]);
 const next=importNativeShares(storage,native([action()]),()=>{});assert.deepEqual(next.analyseIds,[reel.id]);
});
test('intermediate native snapshots preserve later local saves and uploaded originals',()=>{
 const local=addReels([reel],['https://www.instagram.com/reel/LaterLocal/']).map(r=>({...r,autoAnalyse:false}));
 const id=crypto.randomUUID(),upload={id:'upload-'+id,url:'/api/upload?id='+id,platform:'Uploaded video',addedAt:'2026-11-19T12:00:00Z',title:'My original',upload:{id,expiresAt:'2026-11-26T12:00:00Z',mimeType:'video/mp4',size:500,durationSeconds:5},autoAnalyse:false};
 // Upload references use the existing private media URL contract.
 const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify([...local,upload])});
 const result=importNativeShares(storage,native(),()=>{});
 assert.equal(result.library.length,3);assert.ok(result.library.some(row=>row.id===local[0].id));assert.deepEqual(result.library.find(row=>row.id===upload.id),upload);assert.equal(result.library.find(row=>row.id===reel.id).autoAnalyse,false);
});
test('failed import storage restores prior membership and does not acknowledge intent',()=>{
 const buckets=createBucket([],'Food'),storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify([reel]),[BUCKETS_KEY]:JSON.stringify(buckets)}),before=new Map(storage.values),original=storage.setItem;
 storage.setItem=(key,value)=>{if(key===NATIVE_SHARE_RECEIPTS_KEY)throw Error('Storage full');original(key,value);};
 assert.throws(()=>importNativeShares(storage,native([action({bundleId:buckets[0].id})]),()=>{}),/Storage full/);
 assert.deepEqual(storage.values,before);
});
test('corrupt local bundles or receipts stop import without overwriting saved data',()=>{
 for(const key of [BUCKETS_KEY,NATIVE_SHARE_RECEIPTS_KEY]){
  const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify([reel]),[key]:'{broken'}),before=new Map(storage.values);
  assert.throws(()=>importNativeShares(storage,native([action()]),()=>{}));assert.deepEqual(storage.values,before);
 }
});
test('receipt retention keeps every currently pending acknowledged action while bounding old history',()=>{
 const first=action(),history=[first.id,...Array.from({length:999},()=>crypto.randomUUID())],storage=memoryStorage({[NATIVE_SHARE_RECEIPTS_KEY]:JSON.stringify(history)});
 const newer=Array.from({length:99},()=>action({openAnalysis:false}));
 const result=importNativeShares(storage,native([first,...newer]),()=>{}),saved=JSON.parse(storage.getItem(NATIVE_SHARE_RECEIPTS_KEY)).ids;
 assert.equal(saved.length,1000);assert.ok(saved.includes(first.id));assert.deepEqual(result.analyseIds,[]);
 const replay=importNativeShares(storage,native([first]),()=>{});assert.equal(replay.individual,undefined);assert.deepEqual(replay.acknowledged,[first.id]);
});
test('crash after import but before ensure retains the one-shot retry intent across reload',()=>{
 const previous={status:'error',message:'Old failed attempt',runId:crypto.randomUUID(),updatedAt:Date.now()},storage=memoryStorage({[ANALYSIS_KEY]:JSON.stringify({[reel.id]:previous})}),request=action();
 const imported=importNativeShares(storage,native([request]),()=>{});
 const [resume]=pendingNativeAnalyses(storage,imported.library);assert.equal(resume.retry,true);assert.equal(resume.actionId,request.id);
 // A process restart sees the same durable intent even if native acknowledged it.
 const restarted=memoryStorage(Object.fromEntries(storage.values));assert.equal(pendingNativeAnalyses(restarted,imported.library)[0].retry,true);
 const running={status:'working',runId:crypto.randomUUID(),jobId:crypto.randomUUID(),updatedAt:previous.updatedAt+1};
 restarted.setItem(ANALYSIS_KEY,JSON.stringify({[reel.id]:running}));
 assert.equal(pendingNativeAnalyses(restarted,imported.library)[0].retry,false);
 restarted.setItem(ANALYSIS_KEY,JSON.stringify({[reel.id]:{...running,status:'error',message:'New attempt failed',updatedAt:running.updatedAt+1}}));
 assert.deepEqual(pendingNativeAnalyses(restarted,imported.library),[]);
});
test('completion of a superseded native request cannot consume its replacement intent',()=>{
 const storage=memoryStorage(),first=action(),second=action();importNativeShares(storage,native([first]),()=>{});const imported=importNativeShares(storage,native([second]),()=>{});
 finishNativeAnalysis(storage,reel.id,first.id);assert.equal(pendingNativeAnalyses(storage,imported.library)[0].actionId,second.id);
 finishNativeAnalysis(storage,reel.id,second.id);assert.deepEqual(pendingNativeAnalyses(storage,imported.library),[]);
});
