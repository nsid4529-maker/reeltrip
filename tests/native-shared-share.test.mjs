import test from 'node:test';
import assert from 'node:assert/strict';
import {applyNativeShares,applySharedShares} from '../lib/native-share.ts';
import {reelID} from '../lib/reel-library.ts';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';

// iPhone Share Extension → shared bucket. The extension queues the share; the
// app's web view (which holds the member cookie) adds it for the group.
const B='0a5b7c1e-2f3d-4e5a-8b6c-7d8e9fa0b1c2',A1='11111111-1111-4111-8111-111111111111',A2='22222222-2222-4222-8222-222222222222',A3='33333333-3333-4333-8333-333333333333';
const reel='https://www.instagram.com/reel/DeSbT_lEZGL/',tok='https://www.tiktok.com/@a/video/123';
const fail=status=>Object.assign(new Error('Paste one individual public Instagram or TikTok video link.'),{status});

test('the personal importer leaves shared-bucket shares queued for the shared step',()=>{
 const library=[{id:reelID(reel),url:reel,platform:'Instagram',addedAt:''}];
 const applied=applyNativeShares([],library,[{id:A1,urls:[reel],sharedBucketId:B,openAnalysis:false},{id:A2,urls:[reel],openAnalysis:false}]);
 assert.deepEqual(applied.acknowledged,[A2],'only the personal share is acknowledged here');
});

test('shared shares are added for the group, then acknowledged',async()=>{
 const calls=[];
 const result=await applySharedShares([{id:A1,urls:[reel,tok],sharedBucketId:B}],[{id:B,name:'Lisbon'}],async(id,url)=>{calls.push([id,url]);return {added:url===reel};});
 assert.deepEqual(calls,[[B,reel],[B,tok]]);
 assert.deepEqual(result,{acknowledged:[A1],messages:['Your shared reel was added for your group.']},'a reel already in the bucket is fine');
});

test('offline, rate limits and server errors keep the share for next time; dead ends are dropped with a message',async()=>{
 for(const status of [0,429,503]){
  const r=await applySharedShares([{id:A1,urls:[reel],sharedBucketId:B}],[],async()=>{throw fail(status);});
  assert.deepEqual(r.acknowledged,[],'status '+status+' stays queued');
 }
 const gone=await applySharedShares([{id:A1,urls:[reel],sharedBucketId:B}],[{id:B,name:'Lisbon'}],async()=>{throw fail(404);});
 assert.deepEqual(gone.acknowledged,[A1]);assert.match(gone.messages[0],/couldn’t go into Lisbon: the bucket was deleted or this app isn’t a member\. It’s safe in your Reel Library/);
 const refused=await applySharedShares([{id:A2,urls:[reel],sharedBucketId:B}],[],async()=>{throw fail(400);});
 assert.deepEqual(refused.acknowledged,[A2]);assert.match(refused.messages[0],/your shared bucket: Paste one individual/);
});

test('malformed or personal actions are ignored, a bad bucket id is dropped, duplicates run once',async()=>{
 const calls=[];const add=async(id,url)=>{calls.push(url);return {added:true};};
 const r=await applySharedShares([{id:A1,urls:[reel]},{id:'nope',urls:[reel],sharedBucketId:B},{id:A2,urls:[reel],sharedBucketId:'x'},{id:A3,urls:[reel],sharedBucketId:B},{id:A3,urls:[reel],sharedBucketId:B},{id:A1,urls:[1],sharedBucketId:B}],[],add);
 assert.deepEqual(r.acknowledged,[A2,A3]);assert.equal(calls.length,1);
});

test('pasting an invite link opens the join page; a cut-off link says what to do',async()=>{
 const real=await import('../lib/shared-client.ts'),went=[],globals=browserGlobals();globals.location={assign:u=>went.push(u)};
 const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'PasteInvite',modules:{'@/lib/track':{track(){}},'@/lib/shared-client':real,'@/lib/native-library':{hasNativeBridge:()=>true}}});
 const token='ab'.repeat(32),type=async v=>{h.elements(n=>n.type==='input')[0].props.onChange({target:{value:v}});await h.flush();h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();};
 await type('https://reeltrip-travel-studio.earthylark68.chatgpt.site/join#'+token);
 assert.deepEqual(went,['/join#'+token]);
 await type('https://reeltrip-travel-studio.earthylark68.chatgpt.site/join#'+token.slice(0,40));
 assert.equal(went.length,1);assert.match(h.text(),/isn’t a whole invite link.*including the part after #/);
});
