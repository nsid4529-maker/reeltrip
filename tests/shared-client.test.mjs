import test from 'node:test';
import assert from 'node:assert/strict';
import {inviteLink,tokenFromHash,rememberShared,sharedFor,SHARED_LINKS_KEY,getShared,createShared,addSharedReel,voteShared,SharedError} from '../lib/shared-client.ts';
import {memoryStorage} from './helpers/component-harness.mjs';

test('invite links carry the token in the fragment, never the query string',()=>{
 const token='ab'.repeat(32),link=inviteLink('https://reeltrip.test',token),url=new URL(link);
 assert.equal(url.pathname,'/join');assert.equal(url.search,'');assert.equal(tokenFromHash(url.hash),token);
 assert.equal(tokenFromHash('#not-a-token'),null);assert.equal(tokenFromHash(''),null);
});
test('the personal-to-shared shortcut survives damaged storage and keeps other entries',()=>{
 const storage=memoryStorage({[SHARED_LINKS_KEY]:'{broken'}),id='00000000-0000-4000-8000-000000000001';
 assert.equal(sharedFor(storage,'trip-1'),null);
 rememberShared(storage,'trip-1',id);rememberShared(storage,'trip-2',id.replace(/1$/,'2'));
 assert.equal(sharedFor(storage,'trip-1'),id);assert.equal(sharedFor(storage,'trip-2'),id.replace(/1$/,'2'));
 storage.setItem(SHARED_LINKS_KEY,JSON.stringify({'trip-3':'javascript:alert(1)'}));assert.equal(sharedFor(storage,'trip-3'),null);
});
test('a stalled shared request releases the UI and aborts the request at its deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal,result;
 t.mock.method(globalThis,'fetch',async(_path,init)=>{signal=init.signal;return new Promise(()=>{});});
 const pending=voteShared('bucket','place',1).catch(error=>{result=error;});
 t.mock.timers.tick(30000);
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.ok(result instanceof SharedError);
 assert.equal(result.status,408);
 assert.match(result.message,/Refresh before trying again/);
 assert.equal(signal.aborted,true);
 await pending;
});
test('the shared request deadline also bounds a stalled response body',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let result;
 t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}));
 const pending=getShared('bucket').catch(error=>{result=error;});
 for(let i=0;i<4;i++)await Promise.resolve();
 t.mock.timers.tick(90000);
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(result?.status,408);
 await pending;
});
test('shared requests reject unreadable successful responses and preserve server errors',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('not JSON',{status:200}));
 await assert.rejects(getShared('bucket'),/unreadable response/);
 globalThis.fetch=async()=>Response.json({error:'This bucket is full.'},{status:409});
 await assert.rejects(getShared('bucket'),error=>error instanceof SharedError&&error.status===409&&error.message==='This bucket is full.');
});
test('a completed shared request clears its deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal;
 t.mock.method(globalThis,'fetch',async(_path,init)=>{signal=init.signal;return Response.json({id:'bucket'});});
 assert.deepEqual(await getShared('bucket'),{id:'bucket'});
 t.mock.timers.tick(90000);
 assert.equal(signal?.aborted,false);
});

async function advance(t,ms){t.mock.timers.tick(ms);for(let i=0;i<10;i++)await Promise.resolve();}

test('sharing 12 reels allows each old-job check and new submission to finish without duplicating creation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal,calls=0,finished=false,failure;
 t.mock.method(globalThis,'fetch',async(_path,init)=>{
  calls++;signal=init.signal;
  for(let i=0;i<JSON.parse(init.body).reelUrls.length;i++){
   await new Promise(resolve=>setTimeout(resolve,14900));
   await new Promise(resolve=>setTimeout(resolve,14900));
  }
  return Response.json({id:'bucket',name:'Sri Lanka',skipped:0});
 });
 const pending=createShared('Sri Lanka',Array(12).fill('https://www.instagram.com/reel/example/')).then(value=>{finished=true;return value;},error=>{failure=error;});
 for(let step=0;step<24;step++)await advance(t,14900);
 assert.equal(failure,undefined);assert.equal(finished,true);assert.equal(signal.aborted,false);
 assert.equal((await pending).id,'bucket');assert.equal(calls,1);
});

test('loading a bucket can wait for four sequential processor polls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal,failure,calls=0;
 t.mock.method(globalThis,'fetch',async(_path,init)=>{
  calls++;signal=init.signal;
  for(let i=0;i<4;i++)await new Promise(resolve=>setTimeout(resolve,14900));
  return Response.json({id:'bucket',reels:[]});
 });
 const pending=getShared('bucket').catch(error=>{failure=error;});
 for(let i=0;i<4;i++)await advance(t,14900);
 assert.equal(failure,undefined);assert.equal((await pending).id,'bucket');assert.equal(signal.aborted,false);assert.equal(calls,1);
});

test('retrying a reel can check its previous job before submitting another',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal;
 t.mock.method(globalThis,'fetch',async(_path,init)=>{signal=init.signal;await new Promise(resolve=>setTimeout(resolve,31000));return Response.json({id:'reel',added:false});});
 let failure;const pending=addSharedReel('bucket','https://www.instagram.com/reel/example/').catch(error=>{failure=error;});
 await advance(t,31000);
 assert.equal(failure,undefined);assert.equal((await pending).id,'reel');assert.equal(signal.aborted,false);
});

test('a stalled bulk-create body stays bounded and directs recovery instead of resubmission',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0,signal,result;
 t.mock.method(globalThis,'fetch',async(_path,init)=>{calls++;signal=init.signal;return {ok:true,status:200,json:()=>new Promise(()=>{})};});
 const pending=createShared('Sri Lanka',Array(12).fill('https://www.instagram.com/reel/example/')).catch(error=>{result=error;});
 await advance(t,360000);assert.equal(result,undefined);assert.equal(signal.aborted,false);
 await advance(t,30000);
 assert.equal(result?.status,408);assert.equal(result.bucketMayExist,true);
 assert.match(result.message,/Check your shared buckets before creating another/);assert.equal(signal.aborted,true);assert.equal(calls,1);
 await pending;
});
