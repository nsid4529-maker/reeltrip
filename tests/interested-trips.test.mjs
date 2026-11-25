import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INTERESTS_KEY,changeInterest,editInterest,interestKey,itemForProviderLink,loadInterests,importNativeInterests} from '../lib/interested.ts';
import {TRIPS_KEY,assignTripInterest,createTrip,loadTrips,selectTrip} from '../lib/trip-buckets.ts';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};};
const now='2026-11-18T12:00:00.000Z';
const cafe={kind:'restaurant',title:'Café Soul',place:'Ella',provider:'Place search',url:'https://www.google.com/maps/search/?api=1&query=Cafe+Soul+Ella',sourceId:'reel-one',titleSource:'reel'};
const link='https://www.viator.com/tours/Amsterdam/Sunset-Cruise/d525-12345P1';

test('editing a reel choice preserves identity, source, notes and memberships after reload',()=>{
 const store=memory(),tripA=createTrip(store,'Sri Lanka').activeId,tripB=createTrip(store,'Sri Lanka again').activeId;
 const [saved]=changeInterest(store,cafe,'add',now);assignTripInterest(store,saved.id,true,tripA);assignTripInterest(store,saved.id,true,tripB);
 const [edited]=editInterest(store,saved.id,{title:'Soul Café — lunch',place:'Ella, Sri Lanka',notes:'Ask for vegetarian options'});
 assert.equal(edited.id,saved.id);assert.equal(interestKey(edited),saved.id);assert.equal(edited.sourceId,cafe.sourceId);assert.equal(edited.addedAt,now);assert.equal(edited.titleSource,'user');
 assert.equal(loadInterests(store)[0].notes,'Ask for vegetarian options');assert.equal(loadTrips(store).trips.filter(trip=>trip.interestIds.includes(edited.id)).length,2);
 changeInterest(store,cafe,'add');assert.equal(loadInterests(store).length,1);assert.equal(loadInterests(store)[0].title,edited.title);
 assignTripInterest(store,saved.id,false,tripA);assert.equal(loadTrips(store).trips.find(t=>t.id===tripA).interestIds.length,0);assert.deepEqual(loadTrips(store).trips.find(t=>t.id===tripB).interestIds,[saved.id]);assert.equal(loadInterests(store).length,1);
});

test('provider results improve link-derived labels without replacing edited names or notes',()=>{
 const store=memory(),fromLink=itemForProviderLink(link);changeInterest(store,fromLink,'add',now);
 const exact={...fromLink,title:'Small-group sunset canal cruise with Captain Alex',place:'Amsterdam',titleSource:'provider',sourceId:'reel-canals'};
 const [promoted]=changeInterest(store,exact,'add');assert.equal(promoted.title,exact.title);assert.equal(promoted.place,'Amsterdam');assert.equal(promoted.sourceId,'reel-canals');assert.equal(promoted.id,interestKey(fromLink));
 editInterest(store,promoted.id,{title:'Our anniversary cruise',place:'Amsterdam',notes:'Sunset, quiet boat'});
 changeInterest(store,exact,'add');const [kept]=loadInterests(store);assert.equal(kept.title,'Our anniversary cruise');assert.equal(kept.notes,'Sunset, quiet boat');
});

test('native imports stay unassigned regardless of active trip and receipts survive edits',()=>{
 const store=memory(),first=createTrip(store,'First').activeId,second=createTrip(store,'Second').activeId;
 const receipt='00000000-0000-4000-8000-000000000001';
 const entry={id:receipt,url:link,title:'Shared cruise',kind:'activity',provider:'Viator',addedAt:now};
 importNativeInterests(store,[entry]);const [item]=loadInterests(store);editInterest(store,item.id,{title:'My cruise',place:'Amsterdam',notes:'Evening'});
 selectTrip(store,first);importNativeInterests(store,[entry]);assert.equal(loadInterests(store).length,1);assert.equal(loadInterests(store)[0].title,'My cruise');
 assert.deepEqual(loadTrips(store).trips.map(trip=>trip.interestIds),[[],[]]);assert.deepEqual(JSON.parse(store.getItem(INTERESTS_KEY)).nativeImportIds,[receipt]);
 assignTripInterest(store,item.id,true,second);assert.deepEqual(loadTrips(store).trips.find(t=>t.id===first).interestIds,[]);assert.deepEqual(loadTrips(store).trips.find(t=>t.id===second).interestIds,[item.id]);
});

test('failed assignments keep the global save and leave every trip unchanged',()=>{
 const store=memory(),trip=createTrip(store,'Amsterdam').activeId;changeInterest(store,itemForProviderLink(link),'add',now);
 const beforeTrips=store.getItem(TRIPS_KEY),beforeItems=store.getItem(INTERESTS_KEY),[item]=loadInterests(store);
 const blocked={getItem:store.getItem,setItem:(key,value)=>{if(key===TRIPS_KEY)throw new Error('QuotaExceeded');store.setItem(key,value);}};
 assert.throws(()=>assignTripInterest(blocked,item.id,true,trip),/Quota/);assert.equal(store.getItem(TRIPS_KEY),beforeTrips);assert.equal(store.getItem(INTERESTS_KEY),beforeItems);
 store.setItem(TRIPS_KEY,'{broken');assert.throws(()=>assignTripInterest(store,item.id,true,trip),/kept unchanged/);assert.equal(store.getItem(TRIPS_KEY),'{broken');assert.equal(store.getItem(INTERESTS_KEY),beforeItems);
});

test('invalid or quota-failed edits preserve the complete saved record and receipt history',()=>{
 const store=memory();const [item]=changeInterest(store,cafe,'add',now),before=store.getItem(INTERESTS_KEY);
 for(const details of [{title:'',place:'Ella',notes:''},{title:'Cafe',place:'Ella',notes:'x'.repeat(601)}])assert.throws(()=>editInterest(store,item.id,details),/Check the saved/);
 assert.throws(()=>editInterest({getItem:store.getItem,setItem:()=>{throw new Error('QuotaExceeded');}},item.id,{title:'New name',place:'Ella',notes:''}),/Quota/);
 assert.equal(store.getItem(INTERESTS_KEY),before);
});
