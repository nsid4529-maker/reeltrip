import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';
import {addReels,LIBRARY_KEY} from '../lib/reel-library.ts';
import {createBucket,assignReel,BUCKETS_KEY} from '../lib/reel-buckets.ts';
import {WORKSPACE_RETURN_KEY} from '../lib/workspace-return.ts';
const catalog=JSON.parse(fs.readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8'));
const reels=catalog.slice(0,2).map(source=>addReels([],[source.source_url])[0]);
const ready=index=>({status:'analysis_cached',source:{id:catalog[index].id}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function background(ensure){return {cache:{},restore(){},seedJobs(){},ensure};}
async function home(bg,{storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels)}),session=memoryStorage(),search='',bridge}={}){
 const globals=browserGlobals({storage,session,search});if(bridge)globals.window.webkit={messageHandlers:{reeltripLibrary:{postMessage:bridge}}};
 const nativeModule={'@/lib/native-library':{nativeLibrary:message=>{bridge?.(message);return !!bridge;},nativeLibraryError:()=>null}},analysisModule={'@/components/use-reel-analysis':{useReelAnalysis:()=>bg}};
 const h=await componentHarness('app/page.tsx',{globals,modules:{...nativeModule,...analysisModule,'@/components/interested':{useInterests:()=>({items:[],contains:()=>false})},'@/components/trip-buckets':{useTrips:()=>({activeTrip:null,trips:[]})}}});
 const coordinator=await componentHarness('components/native-reels.tsx',{globals,modules:{...nativeModule,...analysisModule}}),unmount=h.unmount,flush=h.flush;
 h.unmount=()=>{coordinator.unmount();unmount();};h.flush=async()=>{await coordinator.flush();return flush();};return h;
}
const resume=reel=>memoryStorage({[WORKSPACE_RETURN_KEY]:JSON.stringify({version:1,reelId:reel.id})});
const button=(h,label)=>h.elements(node=>node.type==='button'&&h.text(node)===label)[0];
const header=h=>h.elements(node=>node.type?.displayName==='WorkspaceHeader')[0];
const activePreview=h=>h.elements(node=>node.type?.displayName==='ReelPreview')[0];

test('URL plan restores completed state before asking for its analysis',async t=>{
 const order=[],bg=background(async()=>{order.push('ensure');assert.ok(order.includes('restore'));return ready(0);});bg.restore=()=>order.push('restore');
 const h=await home(bg,{search:'?share=1&action=plan&url='+encodeURIComponent(reels[0].url)});t.after(()=>h.unmount());await h.flush();
 assert.equal(order[0],'restore');assert.ok(h.text().includes('Your next stops'));
});
test('returning to a failed reel displays its failure; only Try again requests retry',async t=>{
 const calls=[],bg=background(async(reel,retry)=>{calls.push(retry);if(!retry)throw Error('Previous acquisition failure');return ready(0);});
 const h=await home(bg,{search:'?resume=1',session:resume(reels[0])});t.after(()=>h.unmount());await h.flush();
 assert.deepEqual(calls,[false]);assert.ok(h.text().includes('Previous acquisition failure'));
 button(h,'Try again').props.onClick();await h.flush();assert.deepEqual(calls,[false,true]);assert.ok(h.text().includes('Your next stops'));
});
test('a late failure from another reel cannot replace the newly opened breakdown',async t=>{
 const old=deferred(),bg=background(reel=>reel.id===reels[0].id?old.promise:Promise.resolve(ready(1)));
 const h=await home(bg,{search:'?resume=1',session:resume(reels[0])});t.after(()=>h.unmount());
 header(h).props.onLibrary();h.render();
 const card=h.elements(node=>node.type==='article'&&node.key===reels[1].id)[0];
 const find=node=>Array.isArray(node)?node.map(find).find(Boolean):node&&typeof node==='object'?(node.type==='button'&&h.text(node)==='View analysis'?node:find(node.props?.children)):undefined;
 find(card).props.onClick();await h.flush();old.reject(Error('Stale first-reel failure'));await h.flush();
 assert.equal(activePreview(h).props.url,catalog[1].source_url);assert.ok(h.text().includes('Your next stops'));assert.ok(!h.text().includes('Stale first-reel failure'));
});
test('leaving a bundle stops foreground continuation while allowing accepted work to finish',async t=>{
 let bundles=createBucket([],'Two reels');for(const reel of reels)bundles=assignReel(bundles,bundles[0].id,reel.id);
 const first=deferred(),calls=[],bg=background(reel=>{calls.push(reel.id);return first.promise;});
 // Keep the automatic bundle queue empty so this exercises the foreground loop.
 bg.cache=Object.fromEntries(reels.map(reel=>[reel.id,{status:'error'}]));
 const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels),[BUCKETS_KEY]:JSON.stringify(bundles)}),session=memoryStorage({[WORKSPACE_RETURN_KEY]:JSON.stringify({version:1,reelId:reels[0].id,bundleId:bundles[0].id})});
 const h=await home(bg,{search:'?resume=1',storage,session});t.after(()=>h.unmount());assert.deepEqual(calls,[reels[0].id]);
 header(h).props.onLibrary();h.render();first.resolve(ready(0));await h.flush();
 assert.deepEqual(calls,[reels[0].id]);assert.ok(!button(h,'Back to Reel Library'));
});
test('accepted native replacement reconnects the open reel and ignores the superseded rejection',async t=>{
 const old=deferred(),fresh=deferred();let current=old.promise;
 const bg=background(()=>current);bg.seedJobs=jobs=>{if(Object.keys(jobs).length){current=fresh.promise;old.reject(new DOMException('Superseded','AbortError'));}};
 const h=await home(bg,{search:'?resume=1',session:resume(reels[0])});t.after(()=>h.unmount());
 const job=crypto.randomUUID(),request={id:crypto.randomUUID(),urls:[reels[0].url],bundleId:crypto.randomUUID(),openAnalysis:false,jobs:{[reels[0].url]:job}};
 h.globals.window.dispatchEvent(new CustomEvent('reeltrip-native-library',{detail:{videos:[reels[0]],pendingShares:[request]}}));
 await h.flush();assert.ok(!h.text().includes('Superseded'));fresh.resolve(ready(0));await h.flush();assert.ok(h.text().includes('Your next stops'));
});
test('a background retry updates the open failed view and stale completion cannot replace it',async t=>{
 const old=deferred(),bg=background(()=>old.promise);
 const h=await home(bg,{search:'?resume=1',session:resume(reels[0])});t.after(()=>h.unmount());
 bg.cache={[reels[0].id]:{status:'error',message:'Prior attempt failed',updatedAt:1}};h.render();assert.ok(h.text().includes('Prior attempt failed'));
 bg.cache={[reels[0].id]:{status:'working',jobId:crypto.randomUUID(),clip:{status:'processing',stage:'transcribing'},updatedAt:2}};h.render();assert.ok(h.text().includes('Listening to the creator'));
 bg.cache={[reels[0].id]:{status:'complete',clip:ready(0),updatedAt:3}};h.render();assert.ok(h.text().includes('Your next stops'));
 old.reject(Error('Late stale error'));await h.flush();assert.ok(!h.text().includes('Late stale error'));assert.ok(h.text().includes('Your next stops'));
});
test('lost bridge acknowledgement does not prevent analysis or replay it after remount',async t=>{
 const storage=memoryStorage(),request={id:crypto.randomUUID(),urls:[reels[0].url],openAnalysis:true},payload={videos:[reels[0]],pendingShares:[request]},calls=[],acks=[];
 const bg=background(async(reel,retry)=>{calls.push(retry);return ready(0);});
 const h=await home(bg,{storage,bridge:message=>{if(message.action==='acknowledge')throw Error('Bridge disconnected');}});
 h.globals.window.dispatchEvent(new CustomEvent('reeltrip-native-library',{detail:payload}));await h.flush();assert.ok(calls.length>0);const before=calls.length;h.unmount();
 const next=await home(bg,{storage,bridge:message=>{if(message.action==='acknowledge')acks.push(...message.ids);}});t.after(()=>next.unmount());
 next.globals.window.dispatchEvent(new CustomEvent('reeltrip-native-library',{detail:payload}));await next.flush();
 assert.equal(calls.length,before);assert.deepEqual(acks,[request.id]);assert.ok(!button(next,'Back to Reel Library'));
});
