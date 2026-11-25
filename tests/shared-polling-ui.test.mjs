import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';
const id='00000000-0000-4000-8000-0000000000a9';
const bucket=status=>({id,name:'Kyoto',updatedAt:1,me:{id:'m1',name:'Mei',role:'owner'},members:[{id:'m1',name:'Mei',role:'owner'}],maxMembers:6,reels:[{id:'r1',key:'instagram-example',url:'https://www.instagram.com/reel/example/',addedBy:{id:'m1',name:'Mei'},addedAt:1,status,title:'Kyoto',creator:'Creator',platform:'Instagram',message:'',places:[],canRemove:true}],invites:[],trip:{start:null,end:null,travellers:1,travellersSet:false},shortlist:null});
async function setup(read){
 const timers=new Map(),globals=browserGlobals();let sequence=0;
 Object.assign(globals,{setInterval(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearInterval(id){timers.delete(id);}});
 const client=await import('../lib/shared-client.ts');
 const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'SharedBucketView',props:{id},modules:{'@/lib/track':{track(){}},'@/lib/shared-client':{...client,getShared:read,addSharedReel:async()=>({id:'r1',added:false})}}});
 await h.flush();return {h,globals,timers,tick:()=>{for(const {fn} of timers.values())fn();}};
}
test('active analyses poll at five seconds, ready buckets return to fifteen seconds, and hidden pages wait',async()=>{
 let state='analysing',calls=0;
 const {h,globals,timers,tick}=await setup(async()=>{calls++;return bucket(state);});
 assert.deepEqual([...timers.values()].map(t=>t.ms),[5000]);const previousTimer=[...timers.keys()][0];tick();await h.flush();assert.notEqual([...timers.keys()][0],previousTimer);
 globals.document.visibilityState='hidden';tick();globals.window.dispatchEvent(new Event('focus'));globals.document.dispatchEvent(new Event('visibilitychange'));await h.flush();assert.equal(calls,2);
 globals.document.visibilityState='visible';state='ready';globals.document.dispatchEvent(new Event('visibilitychange'));await h.flush();
 assert.equal(calls,3);assert.deepEqual([...timers.values()].map(t=>t.ms),[15000]);h.unmount();assert.equal(timers.size,0);
 globals.window.dispatchEvent(new Event('focus'));assert.equal(calls,3);
});
test('focus, timer and mutation reload never overlap; mutation gets one fresh read after an in-flight result',async()=>{
 let calls=0,active=0,peak=0,finish;
 const {h,globals,tick}=await setup(async()=>{calls++;active++;peak=Math.max(peak,active);if(calls===2)await new Promise(resolve=>{finish=resolve;});active--;return bucket(calls>=3?'analysing':'ready');});
 globals.window.dispatchEvent(new Event('focus'));await h.flush();assert.equal(calls,2);
 tick();globals.window.dispatchEvent(new Event('focus'));
 await h.elements(n=>n.type==='button'&&h.text(n)==='Check reel again')[0].props.onClick();await h.flush();assert.equal(calls,2);
 finish();await h.flush();assert.equal(calls,3);assert.equal(peak,1);assert.match(h.text(),/Finding places/);h.unmount();
});
test('unmount discards a queued mutation reload after the pending read completes',async()=>{
 let calls=0,finish;const {h,globals}=await setup(async()=>{calls++;if(calls===2)await new Promise(resolve=>{finish=resolve;});return bucket('ready');});
 globals.window.dispatchEvent(new Event('focus'));await h.flush();
 await h.elements(n=>n.type==='button'&&h.text(n)==='Check reel again')[0].props.onClick();h.unmount();finish();await h.flush();assert.equal(calls,2);
});
