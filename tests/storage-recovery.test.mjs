import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';
import {addReels,LIBRARY_KEY} from '../lib/reel-library.ts';
import {createBucket,assignReel,BUCKETS_KEY} from '../lib/reel-buckets.ts';
import {createTrip,loadTrips,updateTrip,changeTripReferences} from '../lib/trip-buckets.ts';
import {removeSavedReel} from '../lib/reel-import.ts';
import {generateItinerary} from '../lib/itinerary.ts';
import {GUEST_ITINERARY_KEY,readSavedItinerary,loadSavedItinerary,editSavedItinerary,replaceSavedItinerary} from '../lib/itinerary-storage.ts';
const catalog=JSON.parse(fs.readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8'));
const reels=catalog.slice(0,2).map(source=>addReels([],[source.source_url])[0]);
const trip={prompt:'',selected:['ella'],dates:[{start:'2099-01-02',end:'2099-01-05'}],activeDate:0,adults:2,currency:'GBP',diningTime:'19:00'};
const draft=generateItinerary(trip,'auto'),key=GUEST_ITINERARY_KEY;
const saved=()=>({draft,notes:{},base:'auto'});
const button=(h,label)=>h.elements(n=>n.type==='button'&&h.text(n)===label)[0];
const note=(h,day)=>h.elements(n=>n.type==='textarea'&&n.props['aria-label']==='Notes for day '+day)[0];
const changeNote=(h,day,value)=>{note(h,day).props.onChange({target:{value}});h.render();};
const storageEvent=(h,key)=>{h.globals.window.dispatchEvent(Object.assign(new Event('storage'),{key}));h.render();};
const props={trip,run:0,onSource(){},onGenerate(){}};
const itinerary=storage=>componentHarness('components/itinerary.tsx',{exportName:'ItineraryView',props,globals:browserGlobals({storage})});
async function home(storage){return componentHarness('app/page.tsx',{globals:browserGlobals({storage}),modules:{'@/lib/native-library':{nativeLibrary:()=>false},'@/components/use-reel-analysis':{useReelAnalysis:()=>({cache:Object.fromEntries(reels.map(r=>[r.id,{status:'error'}])),restore(){},seedJobs(){},ensure(){throw Error('Unexpected analysis');}})},'@/components/interested':{useInterests:()=>({items:[],contains:()=>false})},'@/components/trip-buckets':{useTrips:()=>({activeTrip:null,trips:[]})}}});}
function createHomeBundle(h,name){h.elements(n=>n.type==='input'&&n.props.id==='collection-name')[0].props.onChange({target:{value:name}});h.render();h.elements(n=>n.type==='form'&&n.props.className==='bundle-create-form')[0].props.onSubmit({preventDefault(){}});h.render();}

test('two Home tabs preserve bundle creation even before storage events, and refresh on storage/focus',async t=>{
 const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels)}),a=await home(storage),b=await home(storage);t.after(()=>{a.unmount();b.unmount();});
 createHomeBundle(a,'Food');createHomeBundle(b,'Beaches');assert.deepEqual(JSON.parse(storage.getItem(BUCKETS_KEY)).map(b=>b.name),['Food','Beaches']);
 storageEvent(a,BUCKETS_KEY);assert.ok(a.text().includes('Beaches'));
 const third=createBucket(JSON.parse(storage.getItem(BUCKETS_KEY)),'Trains');storage.setItem(BUCKETS_KEY,JSON.stringify(third));b.globals.window.dispatchEvent(new Event('focus'));b.render();assert.ok(b.text().includes('Trains'));
});
test('actual stale bundle checkbox preserves the other tab membership and corrupt storage stays unchanged',async t=>{
 let bundles=createBucket([],'Food');const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels),[BUCKETS_KEY]:JSON.stringify(bundles)}),a=await home(storage),b=await home(storage);t.after(()=>{a.unmount();b.unmount();});
 const first=a.elements(n=>n.type==='input'&&n.props.type==='checkbox')[0],second=b.elements(n=>n.type==='input'&&n.props.type==='checkbox')[1];
 first.props.onChange({target:{checked:true}});second.props.onChange({target:{checked:true}});a.render();b.render();assert.deepEqual(JSON.parse(storage.getItem(BUCKETS_KEY))[0].reelIds,reels.map(r=>r.id));
 storage.setItem(BUCKETS_KEY,'{invalid');createHomeBundle(b,'Do not erase');assert.equal(storage.getItem(BUCKETS_KEY),'{invalid');assert.match(b.text(),/kept unchanged/);
});
test('actual trip attachment handlers merge against current storage for all reference types',async t=>{
 const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels)}),state=createTrip(storage,'Travel'),id=state.activeId;
 let bundles=createBucket(createBucket([],'Food'),'Clubs');storage.setItem(BUCKETS_KEY,JSON.stringify(bundles));
 const interests=[{id:'activity:first',title:'First',kind:'activity'},{id:'activity:second',title:'Second',kind:'activity'}];
 const makeProps=()=>({trip:loadTrips(storage).trips[0],reels,bundles,interests,update:patch=>{updateTrip(storage,id,patch);return true;},references:(field,ids,include)=>{changeTripReferences(storage,id,field,ids,include);return true;},remove:()=>false,blocked:false,tab:'sources'});
 const a=await componentHarness('app/trips/page.tsx',{exportName:'TripWorkspace',expose:['TripWorkspace'],props:makeProps()}),b=await componentHarness('app/trips/page.tsx',{exportName:'TripWorkspace',expose:['TripWorkspace'],props:makeProps()});t.after(()=>{a.unmount();b.unmount();});
 const check=h=>h.elements(n=>n.type==='input'&&n.props.type==='checkbox');
 for(const offset of [0,2,4]){check(a)[offset].props.onChange({target:{checked:true}});check(b)[offset+1].props.onChange({target:{checked:true}});}
 const current=loadTrips(storage).trips[0];assert.deepEqual(current.bundleIds,bundles.map(b=>b.id));assert.deepEqual(current.reelIds,reels.map(r=>r.id));assert.deepEqual(current.interestIds,interests.map(i=>i.id));
 check(a)[2].props.onChange({target:{checked:false}});assert.deepEqual(loadTrips(storage).trips[0].reelIds,[reels[1].id]);
});
test('itinerary hydration never writes valid records, and separate stale day edits merge',async t=>{
 const raw=JSON.stringify(saved()),storage=memoryStorage({[key]:raw}),a=await itinerary(storage),b=await itinerary(storage);t.after(()=>{a.unmount();b.unmount();});assert.equal(storage.getItem(key),raw);
 changeNote(a,1,'Train transfer');changeNote(b,2,'Lunch reservation');assert.deepEqual(JSON.parse(storage.getItem(key)).notes,{[draft.days[0].date]:'Train transfer',[draft.days[1].date]:'Lunch reservation'});
 storageEvent(a,key);assert.equal(note(a,2).props.value,'Lunch reservation');
});
test('same-day note conflicts keep saved and unsaved text separate until explicitly reloaded',async t=>{
 const storage=memoryStorage({[key]:JSON.stringify(saved())}),a=await itinerary(storage),b=await itinerary(storage);t.after(()=>{a.unmount();b.unmount();});
 changeNote(a,1,'Saved first edit');changeNote(b,1,'Unsaved second edit');assert.equal(JSON.parse(storage.getItem(key)).notes[draft.days[0].date],'Saved first edit');assert.equal(note(b,1).props.value,'Unsaved second edit');assert.match(b.text(),/another tab/);
 storageEvent(b,key);assert.equal(note(b,1).props.value,'Unsaved second edit');button(b,'Load saved version').props.onClick();b.render();assert.equal(note(b,1).props.value,'Saved first edit');
});
test('a new draft cannot overwrite newer notes or be replaced by stale note handlers',async t=>{
 const storage=memoryStorage({[key]:JSON.stringify(saved())}),a=await itinerary(storage),b=await itinerary(storage);t.after(()=>{a.unmount();b.unmount();});
 changeNote(a,1,'Newer saved note');b.render({...props,run:1});assert.equal(JSON.parse(storage.getItem(key)).notes[draft.days[0].date],'Newer saved note');assert.match(b.text(),/another tab/);
 changeNote(b,2,'Keep with unsaved new draft');assert.equal(note(b,2).props.value,'Keep with unsaved new draft');assert.equal(JSON.parse(storage.getItem(key)).notes[draft.days[1].date],undefined);
 const older=loadSavedItinerary(storage,key),newDraft={...draft,createdAt:'2099-01-01T00:00:00Z'};replaceSavedItinerary(storage,key,older,newDraft,'auto');
 assert.throws(()=>editSavedItinerary(storage,key,older,{notes:{[draft.days[0].date]:'Old draft note'}}),/another tab/);assert.deepEqual(JSON.parse(storage.getItem(key)).notes,{});
});
test('failed note writes keep all pending days and can retry without erasing untouched notes',async t=>{
 const base=memoryStorage({[key]:JSON.stringify(saved())});let fail=true;
 const storage={...base,setItem(k,v){if(fail&&k===key)throw Error('Quota');base.setItem(k,v);}},h=await itinerary(storage);t.after(()=>h.unmount());
 changeNote(h,1,'Pending transfer');changeNote(h,2,'Pending lunch');assert.deepEqual(JSON.parse(base.getItem(key)).notes,{});assert.equal(note(h,1).props.value,'Pending transfer');assert.equal(note(h,2).props.value,'Pending lunch');
 fail=false;button(h,'Retry saving changes').props.onClick();h.render();assert.deepEqual(JSON.parse(base.getItem(key)).notes,{[draft.days[0].date]:'Pending transfer',[draft.days[1].date]:'Pending lunch'});
});
test('a draft generated during a storage failure keeps new notes on successful retry',async t=>{
 const base=memoryStorage();let fail=true;const storage={...base,setItem(k,v){if(fail&&k===key)throw Error('Quota');base.setItem(k,v);}},h=await itinerary(storage);t.after(()=>h.unmount());
 h.render({...props,run:1});changeNote(h,1,'Note for unsaved generated draft');assert.equal(base.getItem(key),null);assert.equal(note(h,1).props.value,'Note for unsaved generated draft');
 fail=false;button(h,'Retry saving changes').props.onClick();h.render();assert.equal(JSON.parse(base.getItem(key)).notes[draft.days[0].date],'Note for unsaved generated draft');
});
test('malformed or unsupported saved itineraries show recovery without crashing or rewriting raw data',async t=>{
 const bad=[{...saved(),draft:{...draft,days:[]}},{...saved(),draft:{...draft,days:[{...draft.days[0],stops:null}]}},{...saved(),draft:{...draft,includedSources:null}},{...saved(),notes:{[draft.days[0].date]:{unsafe:'object'}}},{...saved(),version:99},{draft:{unsupported:true},notes:{[draft.days[0].date]:'Keep me'},base:'auto'}];
 for(const raw of ['{broken',...bad.map(x=>JSON.stringify(x))]){const storage=memoryStorage({[key]:raw}),h=await itinerary(storage);t.after(()=>h.unmount());assert.equal(storage.getItem(key),raw);assert.match(h.text(),/kept unchanged/);h.render({...props,run:1});assert.equal(storage.getItem(key),raw);assert.ok(button(h,'Export itinerary'));}
});
test('complete reviewed drafts and their bounded notes remain valid across hydration',()=>{
 for(const selected of [['ella'],['sigiriya'],['shreya'],['kanisha']]){const d=generateItinerary({...trip,selected});const record=readSavedItinerary(JSON.stringify({draft:d,base:'auto',notes:{[d.days[0].date]:'Transfers\nLunch'}}));assert.deepEqual(record.draft,JSON.parse(JSON.stringify(d)));assert.equal(record.notes[d.days[0].date],'Transfers\nLunch');}
});
test('actual Home removal rolls back memberships and keeps its modal after a second-write failure',async t=>{
 let bundles=createBucket([],'Food');bundles=assignReel(bundles,bundles[0].id,reels[0].id);
 const base=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels),[BUCKETS_KEY]:JSON.stringify(bundles)});let fail=false;const storage={...base,setItem(k,v){if(fail&&k===LIBRARY_KEY)throw Error('Quota');base.setItem(k,v);}},h=await home(storage);t.after(()=>h.unmount());
 h.elements(n=>n.type==='button'&&n.props.className==='reel-title')[0].props.onClick();h.render();fail=true;button(h,'Remove from Reel Library').props.onClick();h.render();
 assert.deepEqual(JSON.parse(base.getItem(BUCKETS_KEY)),bundles);assert.deepEqual(JSON.parse(base.getItem(LIBRARY_KEY)),reels);assert.ok(button(h,'Remove from Reel Library'));assert.match(h.text(),/could not be removed/);
 fail=false;button(h,'Remove from Reel Library').props.onClick();h.render();assert.deepEqual(JSON.parse(base.getItem(BUCKETS_KEY))[0].reelIds,[]);assert.deepEqual(JSON.parse(base.getItem(LIBRARY_KEY)).map(r=>r.id),[reels[1].id]);assert.equal(button(h,'Remove from Reel Library'),undefined);
});
test('removal rejects corrupt stores before writing and reports rollback failures honestly',()=>{
 let bundles=createBucket([],'Food');bundles=assignReel(bundles,bundles[0].id,reels[0].id);
 for(const broken of [LIBRARY_KEY,BUCKETS_KEY]){const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels),[BUCKETS_KEY]:JSON.stringify(bundles),[broken]:'{bad'}),before=new Map(storage.values);assert.throws(()=>removeSavedReel(storage,reels[0].id),/kept unchanged/);assert.deepEqual(storage.values,before);}
 const base=memoryStorage({[LIBRARY_KEY]:JSON.stringify(reels),[BUCKETS_KEY]:JSON.stringify(bundles)}),before=new Map(base.values);
 assert.throws(()=>removeSavedReel({...base,setItem(){throw Error('Storage unavailable');}},reels[0].id),/could not be removed/);assert.deepEqual(base.values,before);
 let writes=0;const blockedRollback={...base,setItem(k,v){writes++;if(writes>1)throw Error('Storage became unavailable');base.setItem(k,v);}};
 assert.throws(()=>removeSavedReel(blockedRollback,reels[0].id),/could not be fully restored/);assert.deepEqual(JSON.parse(base.getItem(LIBRARY_KEY)),reels);

});
