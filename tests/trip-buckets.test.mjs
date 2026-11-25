import test from 'node:test';
import assert from 'node:assert/strict';
import {TRIPS_KEY,createTrip,loadTrips,readTrips,selectTrip,updateTrip,removeTrip,assignTripInterest,getTripReels} from '../lib/trip-buckets.ts';
import {BUCKETS_KEY} from '../lib/reel-buckets.ts';
import {LIBRARY_KEY} from '../lib/reel-library.ts';
const now='2026-11-18T12:00:00.000Z';
function memory(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
const reel=n=>({id:'instagram-reel'+n,url:'https://www.instagram.com/reel/reel'+n+'/',platform:'Instagram',addedAt:now});
const bundle=(id,ids)=>({id,name:id,reelIds:ids,createdAt:now});
function create(storage,name='Sri Lanka'){return createTrip(storage,name,name,now).trips[0];}

test('trip buckets keep preferences and interests isolated across two trips',()=>{
 const s=memory(),a=create(s),b=create(s,'Amsterdam');
 updateTrip(s,a.id,{dates:[{start:'2027-01-10',end:'2027-01-18'},{start:'2027-02-10',end:'2027-02-18'}],activeDate:1,adults:4,currency:'EUR',brief:'Food and train rides'});
 assignTripInterest(s,'activity:viator:123P1',true,a.id);assignTripInterest(s,'restaurant:ivy',true,b.id);
 selectTrip(s,a.id);const restored=loadTrips(s),first=restored.trips.find(t=>t.id===a.id),second=restored.trips.find(t=>t.id===b.id);
 assert.equal(restored.activeId,a.id);assert.equal(first.activeDate,1);assert.equal(first.adults,4);assert.equal(first.brief,'Food and train rides');assert.equal(first.currency,'EUR');
 assert.deepEqual(first.interestIds,['activity:viator:123P1']);assert.deepEqual(second.interestIds,['restaurant:ivy']);assert.deepEqual(second.dates,[{start:'',end:''}]);assert.equal(second.adults,2);
 selectTrip(s,null);assert.equal(loadTrips(s).activeId,null);
});
test('membership deduplicates overlapping bundles and standalone reels',()=>{
 const resolved=getTripReels({bundleIds:['food','food','sights'],reelIds:[reel(1).id,reel(1).id]},[bundle('food',[reel(1).id,reel(2).id]),bundle('sights',[reel(2).id,reel(3).id])],[reel(1),reel(2),reel(3)]);
 assert.equal(resolved.total,3);assert.deepEqual(resolved.reels.map(r=>r.id),[reel(1).id,reel(2).id,reel(3).id]);assert.equal(resolved.overLimit,false);
 const s=memory(),t=create(s);updateTrip(s,t.id,{reelIds:[reel(1).id,reel(1).id],interestIds:['activity:a','activity:a']});const saved=loadTrips(s).trips[0];assert.equal(saved.reelIds.length,1);assert.equal(saved.interestIds.length,1);
});
test('missing references stay visible and count toward bounded planning',()=>{
 const result=getTripReels({bundleIds:['gone','food'],reelIds:['missing','also-missing']},[bundle('food',['missing',reel(1).id])],[reel(1)]);
 assert.deepEqual(result.missingBundleIds,['gone']);assert.deepEqual(result.missingReelIds,['missing','also-missing']);assert.equal(result.total,3);assert.equal(result.reels.length,1);
});
test('attaching over twelve unique reels fails without losing source memberships',()=>{
 const s=memory(),t=create(s),reels=Array.from({length:13},(_,i)=>reel(i));
 s.setItem(LIBRARY_KEY,JSON.stringify(reels));s.setItem(BUCKETS_KEY,JSON.stringify([bundle('food',reels.slice(0,12).map(r=>r.id)),bundle('extra',[reel(12).id])]));
 updateTrip(s,t.id,{bundleIds:['food']});const before=s.getItem(TRIPS_KEY);
 assert.throws(()=>updateTrip(s,t.id,{bundleIds:['food','extra']}),/12 unique reels/);assert.equal(s.getItem(TRIPS_KEY),before);
 assert.throws(()=>updateTrip(s,t.id,{reelIds:reels.map(r=>r.id)}),/too many/);
});
test('live bundle growth is not truncated and allows repair without deleting originals',()=>{
 const s=memory(),t=create(s),reels=Array.from({length:14},(_,i)=>reel(i));s.setItem(LIBRARY_KEY,JSON.stringify(reels));
 s.setItem(BUCKETS_KEY,JSON.stringify([bundle('food',reels.slice(0,10).map(r=>r.id)),bundle('sights',reels.slice(10,12).map(r=>r.id))]));updateTrip(s,t.id,{bundleIds:['food','sights']});
 const grown=[bundle('food',reels.slice(0,12).map(r=>r.id)),bundle('sights',reels.slice(10).map(r=>r.id))];s.setItem(BUCKETS_KEY,JSON.stringify(grown));
 const found=getTripReels(loadTrips(s).trips[0],grown,reels);assert.equal(found.total,14);assert.equal(found.reels.length,14);assert.equal(found.overLimit,true);
 updateTrip(s,t.id,{brief:'Still saved while fixing sources'});updateTrip(s,t.id,{bundleIds:['food']});assert.equal(getTripReels(loadTrips(s).trips[0],grown,reels).overLimit,false);assert.deepEqual(JSON.parse(s.getItem(BUCKETS_KEY)),grown);
});
test('removing a trip or reference never deletes library, bundles or global interested records',()=>{
 const s=memory(),a=create(s),b=create(s,'Amsterdam');s.setItem(LIBRARY_KEY,'original-library');s.setItem(BUCKETS_KEY,'[]');s.setItem('reeltrip.interested.v1','original-interests');
 assignTripInterest(s,'activity:a',true,a.id);assignTripInterest(s,'activity:a',false,a.id);assert.deepEqual(loadTrips(s).trips.find(t=>t.id===a.id).interestIds,[]);
 removeTrip(s,b.id);assert.equal(loadTrips(s).activeId,null);assert.equal(loadTrips(s).trips.length,1);assert.equal(s.getItem(LIBRARY_KEY),'original-library');assert.equal(s.getItem('reeltrip.interested.v1'),'original-interests');
});
test('corrupt, oversized, duplicate and future trip stores cannot be overwritten',()=>{
 const valid=memory();create(valid);const state=loadTrips(valid);
 const invalid=['{bad',JSON.stringify({...state,version:2}),JSON.stringify({...state,activeId:'missing'}),JSON.stringify({...state,trips:[state.trips[0],state.trips[0]]}),JSON.stringify({...state,trips:[{...state.trips[0],dates:[{start:'2027-02-30',end:''}]}]}),'x'.repeat(1_000_001)];
 for(const raw of invalid){const s=memory();s.setItem(TRIPS_KEY,raw);assert.throws(()=>readTrips(raw),/kept unchanged/);assert.throws(()=>create(s),/kept unchanged/);assert.throws(()=>assignTripInterest(s,'x',true),/kept unchanged/);assert.equal(s.getItem(TRIPS_KEY),raw);}
});
test('quota and read failures never report a successful mutation or clear existing trips',()=>{
 const s=memory(),t=create(s),before=s.getItem(TRIPS_KEY);const quota={getItem:s.getItem,setItem:()=>{throw new Error('QuotaExceededError');}};
 assert.throws(()=>updateTrip(quota,t.id,{brief:'Not saved'}),/Quota/);assert.equal(s.getItem(TRIPS_KEY),before);
 const denied={getItem:()=>{throw new Error('SecurityError');},setItem:()=>assert.fail('Must never write after a failed read')};assert.throws(()=>create(denied),/Security/);
});
test('mutations reread storage to preserve other views and enforce bounds',()=>{
 const s=memory(),a=create(s);loadTrips(s);const b=create(s,'Amsterdam');updateTrip(s,a.id,{brief:'Edited from old view'});assignTripInterest(s,'activity:b',true,b.id);assert.equal(loadTrips(s).trips.length,2);
 assert.throws(()=>updateTrip(s,a.id,{id:b.id}),/not supported/);assert.throws(()=>updateTrip(s,a.id,{adults:0}),/preferences/);assert.throws(()=>updateTrip(s,a.id,{currency:'BAD'}),/preferences/);assert.throws(()=>updateTrip(s,a.id,{brief:'x'.repeat(3001)}),/too long/);assert.throws(()=>updateTrip(s,a.id,{dates:Array(4).fill({start:'',end:''})}),/three date/);
 updateTrip(s,a.id,{interestIds:Array.from({length:200},(_,i)=>'interest:'+i)});assert.throws(()=>assignTripInterest(s,'one-too-many',true,a.id),/200 interested/);assignTripInterest(s,'interest:0',false,a.id);assert.equal(loadTrips(s).trips.find(t=>t.id===a.id).interestIds.length,199);
});
test('creation is bounded and names are distinct while date drafts persist',()=>{
 const s=memory(),t=create(s);assert.throws(()=>create(s,' sri lanka '),/already/);assert.throws(()=>create(s,''),/field/);
 updateTrip(s,t.id,{dates:[{start:'2027-01-01',end:''}],destination:'South coast'});assert.equal(loadTrips(s).trips[0].dates[0].end,'');
 for(let n=1;n<20;n++)create(s,'Trip '+n);assert.throws(()=>create(s,'Trip twenty-one'),/20 trip/);assert.equal(loadTrips(s).trips.length,20);
});
test('live preference editing preserves spaces and line breaks as the user types',()=>{
 const s=memory(),t=create(s);
 for(const brief of ['Relaxed ','Relaxed pace\n','  Local food\n  Quiet stays  ']){
  updateTrip(s,t.id,{brief});assert.equal(loadTrips(s).trips[0].brief,brief);
 }
});
test('repeating an interest assignment is idempotent even when further writes are unavailable',()=>{
 const s=memory(),t=create(s);assignTripInterest(s,'activity:a',true,t.id);const before=s.getItem(TRIPS_KEY);
 const noWrites={getItem:s.getItem,setItem:()=>assert.fail('An unchanged membership must not write')};
 assert.deepEqual(assignTripInterest(noWrites,'activity:a',true,t.id).trips[0].interestIds,['activity:a']);
 assert.deepEqual(assignTripInterest(noWrites,'missing',false,t.id).trips[0].interestIds,['activity:a']);
 assert.equal(s.getItem(TRIPS_KEY),before);
});
