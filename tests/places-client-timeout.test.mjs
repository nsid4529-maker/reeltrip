import test from 'node:test';
import assert from 'node:assert/strict';
import {venue,resolvePlace,forgetPlace} from '../lib/places-client.ts';

const details=id=>({id,name:'Café',address:'Ella',mapsUri:'',provider:'fixture',lat:6.8,lng:81});

test('a stalled shared details request aborts once; retry is explicit and a late result cannot replace it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let finishOld,calls=0,signal;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;signal=init.signal;
  if(calls===1)return {ok:true,json:()=>new Promise(resolve=>{finishOld=resolve;})};
  return Response.json(details('timeout-detail'));
 });
 const first=venue('timeout-detail'),second=venue('timeout-detail');
 assert.equal(first,second);await Promise.resolve();
 const failed=assert.rejects(first,/Places took too long/);
 t.mock.timers.tick(14999);assert.equal(signal.aborted,false);
 t.mock.timers.tick(1);await failed;assert.equal(signal.aborted,true);assert.equal(calls,1);
 const retry=await venue('timeout-detail');assert.equal(calls,2);assert.equal(retry.name,'Café');
 finishOld({...details('timeout-detail'),name:'Stale result'});await Promise.resolve();await Promise.resolve();
 assert.equal((await venue('timeout-detail')).name,'Café');assert.equal(calls,2);
});

test('an indefinitely pending fetch settles at the deadline even when fetch ignores abort',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal;
 t.mock.method(globalThis,'fetch',(_url,init)=>{signal=init.signal;return new Promise(()=>{});});
 const failed=assert.rejects(venue('timeout-fetch'),/Places took too long/);
 t.mock.timers.tick(15000);await failed;assert.equal(signal.aborted,true);
});

test('successful and rejected requests clear their timer and preserve server errors',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const signals=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  signals.push(init.signal);
  if(url.includes('server-error'))return Response.json({error:'Google is unavailable.'},{status:503});
  if(url.includes('bad-response'))return Response.json(null);
  return Response.json(details('successful-detail'));
 });
 await venue('successful-detail');
 await assert.rejects(venue('server-error'),/Google is unavailable/);
 await assert.rejects(venue('bad-response'),/unreadable response/);
 t.mock.timers.tick(30000);assert.ok(signals.every(signal=>!signal.aborted),'settled requests retain no timeout');
});

test('a resolve batch has a finite deadline allowing its bounded server work and no automatic resubmission',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,signal;
 t.mock.method(globalThis,'fetch',(_url,init)=>{calls++;signal=init.signal;return new Promise(()=>{});});
 const pending=Promise.all(Array.from({length:4},(_,i)=>resolvePlace({key:'slow-batch-'+i,title:'Café '+i,place:'Ella'},'timeout-bucket')));
 const failed=assert.rejects(pending,/Places took too long/);
 t.mock.timers.tick(30);assert.equal(calls,1,'one batched request');
 t.mock.timers.tick(31000);assert.equal(signal.aborted,false,'four stale matches may need two waves of detail+search');
 t.mock.timers.tick(16000);await failed;assert.equal(signal.aborted,true);assert.equal(calls,1);
});

test('a changed input at the same place key cannot reuse the earlier lookup promise',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{calls++;return Response.json({places:JSON.parse(init.body).places.map(p=>({key:p.key,status:'matched',placeId:p.title}))});});
 const old={key:'same-position',title:'Old venue',place:'Kyoto'},updated={...old,title:'New venue'};
 const first=resolvePlace(old,'changed-input');t.mock.timers.tick(30);assert.equal((await first).placeId,'Old venue');
 const second=resolvePlace(updated,'changed-input');assert.notEqual(first,second);t.mock.timers.tick(30);assert.equal((await second).placeId,'New venue');
 assert.equal(resolvePlace(updated,'changed-input'),second);assert.equal(calls,2,'unchanged input remains shared');
 forgetPlace(updated.key,'changed-input');const reset=resolvePlace(updated,'changed-input');t.mock.timers.tick(30);await reset;assert.equal(calls,3,'manual invalidation clears the matching input variant');
});
