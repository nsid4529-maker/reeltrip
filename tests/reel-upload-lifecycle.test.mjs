import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';
import {LIBRARY_KEY,readLibrary} from '../lib/reel-library.ts';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const button=(h,label)=>h.elements(node=>node.type==='button'&&h.text(node)===label)[0];
const uploaded=(title='First video')=>{const id=crypto.randomUUID();return {id:'upload-'+id,url:'/api/upload?id='+id,platform:'Uploaded video',title,addedAt:new Date().toISOString(),upload:{id,mimeType:'video/mp4',size:1024,durationSeconds:30,expiresAt:new Date(Date.now()+7*86400000).toISOString()}};};
const reply=reel=>({ok:true,json:async()=>({reel})});
async function setup(fetcher,bridge=()=>true){
 const storage=memoryStorage(),globals=browserGlobals({storage}),calls=[],timers=new Map();let tick=0;
 globals.fetch=fetcher;globals.setTimeout=(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms});return id;};globals.clearTimeout=id=>timers.delete(id);
 const sources={ready:true,reels:[],bundles:[]},bg={cache:{},restore(){},ensure:async(reel,retry)=>{calls.push({reel,retry});return {status:'not_travel'};}};
 const h=await componentHarness('components/reel-upload.tsx',{globals,modules:{'@/components/trip-buckets':{useTrips:()=>({activeId:'',ready:true,trips:[]})},'@/components/use-trip-sources':{useTripSources:()=>sources},'@/components/use-reel-analysis':{useReelAnalysis:()=>bg},'@/lib/native-library':{nativeLibrary:bridge}}});
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};h.elements(node=>node.type==='dialog')[0].props.ref.current=dialog;
 function open(detail={mode:'file'}){globals.window.dispatchEvent(new CustomEvent('reeltrip:open-upload',{detail}));h.render();}
 function choose(name='first.mp4'){h.elements(node=>node.type==='input'&&node.props.type==='file')[0].props.onChange({target:{files:[{name,type:'video/mp4',size:1024}]}});h.render();}
 function submit(){h.elements(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});}
 return {h,storage,calls,timers,dialog,open,choose,submit};
}
test('cancelled file upload releases the dialog and retains the file; a late result cannot replace its retry',async t=>{
 const first=deferred(),second=deferred(),requests=[],s=await setup((url,options)=>{requests.push({url,options});return requests.length===1?first.promise:second.promise;});t.after(()=>s.h.unmount());
 s.open();s.choose();s.submit();s.submit();await s.h.flush();assert.equal(requests.length,1);assert.ok(requests[0].options.signal);assert.equal(s.timers.size,1);
 button(s.h,'Cancel upload').props.onClick();await s.h.flush();assert.equal(requests[0].options.signal.aborted,true);assert.match(s.h.text(),/first.mp4/);assert.match(s.h.text(),/Upload cancelled/);assert.equal(s.timers.size,0);assert.equal(s.h.elements(node=>node.props?.['aria-label']==='Close upload dialog')[0].props.disabled,false);
 s.choose('retry.mp4');s.submit();await s.h.flush();const fresh=uploaded('Retry video');first.resolve(reply(uploaded('Stale video')));await s.h.flush();assert.equal(readLibrary(s.storage.getItem(LIBRARY_KEY)).length,0);assert.equal(s.calls.length,0);
 second.resolve(reply(fresh));await s.h.flush();assert.equal(readLibrary(s.storage.getItem(LIBRARY_KEY))[0].id,fresh.id);assert.equal(s.calls.length,1);assert.equal(s.calls[0].reel.id,fresh.id);assert.equal(s.dialog.open,false);
});
for(const phase of ['fetch','response body'])test('upload deadline covers '+phase+' and preserves a retry without late writes',async t=>{
 const pending=deferred();let signal;const s=await setup((_url,options)=>{signal=options.signal;return phase==='fetch'?pending.promise:Promise.resolve({ok:true,json:()=>pending.promise});});t.after(()=>s.h.unmount());
 s.open();s.choose();s.submit();await s.h.flush();assert.equal(s.timers.size,1);const timer=[...s.timers.values()][0];assert.equal(timer.ms,300000);timer.fn();await s.h.flush();
 assert.equal(signal.aborted,true);assert.match(s.h.text(),/took too long/);assert.match(s.h.text(),/first.mp4/);assert.ok(button(s.h,'Retry save and analyse'));assert.equal(button(s.h,'Retry save and analyse').props.disabled,false);
 const reel=uploaded();pending.resolve(phase==='fetch'?reply(reel):{reel});await s.h.flush();assert.equal(readLibrary(s.storage.getItem(LIBRARY_KEY)).length,0);assert.equal(s.calls.length,0);
});
test('unmount aborts upload and a transport ignoring abort cannot save or analyse its late response',async()=>{
 const pending=deferred();let signal;const s=await setup((_url,options)=>{signal=options.signal;return pending.promise;});
 s.open();s.choose();s.submit();await s.h.flush();s.h.unmount();assert.equal(signal.aborted,true);pending.resolve(reply(uploaded()));await s.h.flush();assert.equal(s.calls.length,0);assert.equal(readLibrary(s.storage.getItem(LIBRARY_KEY)).length,0);assert.equal(s.timers.size,0);
});
test('Escape cancels an upload and the released dialog can then close',async t=>{
 const s=await setup(()=>new Promise(()=>{}));t.after(()=>s.h.unmount());s.open();s.choose();s.submit();await s.h.flush();let prevented=false;
 s.h.elements(node=>node.type==='dialog')[0].props.onCancel({preventDefault(){prevented=true;}});await s.h.flush();assert.equal(prevented,true);assert.equal(s.dialog.open,true);assert.match(s.h.text(),/Upload cancelled/);
 s.h.elements(node=>node.props?.['aria-label']==='Close upload dialog')[0].props.onClick();s.h.render();assert.equal(s.dialog.open,false);
});
test('native synchronization failure preserves successful save and retries only synchronization',async t=>{
 let broken=true;const bridgeCalls=[],s=await setup(()=>{throw Error('No file upload expected');},message=>{bridgeCalls.push(message);if(broken)throw Error('Bridge disconnected');return true;});t.after(()=>s.h.unmount());
 s.open({link:'https://www.instagram.com/reel/SavedBeforeBridge/'});s.submit();await s.h.flush();assert.equal(readLibrary(s.storage.getItem(LIBRARY_KEY)).length,1);assert.equal(s.calls.length,1);assert.equal(s.dialog.open,false);assert.equal(s.h.elements(node=>node.props?.role==='alert').length,0);assert.match(s.h.text(),/Reel saved/);assert.ok(button(s.h,'Retry iPhone sync'));
 broken=false;button(s.h,'Retry iPhone sync').props.onClick();await s.h.flush();assert.equal(bridgeCalls.length,2);assert.equal(s.calls.length,1);assert.equal(readLibrary(s.storage.getItem(LIBRARY_KEY)).length,1);assert.equal(button(s.h,'Retry iPhone sync'),undefined);
});
