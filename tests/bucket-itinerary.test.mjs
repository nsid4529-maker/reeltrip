import test from 'node:test';
import assert from 'node:assert/strict';
import {assignBucketChoice,bucketItineraryDays,bucketItineraryKey,readBucketItinerary,saveBucketDayNote} from '../lib/bucket-itinerary.ts';

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
function memory(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
const read=(store,id=a)=>readBucketItinerary(store.getItem(bucketItineraryKey(id)));

test('day assignment supports single-day and leap-day windows without timezone drift',()=>{
 assert.deepEqual(bucketItineraryDays({start:'',end:''}),[]);
 assert.deepEqual(bucketItineraryDays({start:'2028-02-28',end:'2028-03-01'}),['2028-02-28','2028-02-29','2028-03-01']);
 assert.deepEqual(bucketItineraryDays({start:'2027-03-28',end:''}),['2027-03-28']);
 assert.deepEqual(bucketItineraryDays({start:'2027-03-28',end:'2027-03-28'}),['2027-03-28']);
 assert.equal(bucketItineraryDays({start:'2027-01-01',end:'2027-01-31'}).length,31);
 for(const dates of [{start:'',end:'2027-01-01'},{start:'2027-02-29',end:''},{start:'2027-01-02',end:'2027-01-01'},{start:'2027-01-01',end:'2027-02-01'}])assert.throws(()=>bucketItineraryDays(dates));
});
test('assignments and day notes remain separate across buckets and the existing reel itinerary',()=>{
 const store=memory();store.setItem('reeltrip-trip-itinerary-v1:'+a,'existing reel draft');
 assignBucketChoice(store,a,'activity:a','2027-01-02');assignBucketChoice(store,b,'activity:a','2027-02-02');
 saveBucketDayNote(store,a,'2027-01-02','  Check lunch times\nKeep this note  ');
 assert.deepEqual(read(store).assignments,[{interestId:'activity:a',date:'2027-01-02'}]);
 assert.equal(read(store).notes[0].text,'  Check lunch times\nKeep this note  ');
 assert.deepEqual(read(store,b).assignments,[{interestId:'activity:a',date:'2027-02-02'}]);assert.deepEqual(read(store,b).notes,[]);
 assert.equal(store.getItem('reeltrip-trip-itinerary-v1:'+a),'existing reel draft');
 assert.equal(bucketItineraryKey(a.toUpperCase()),bucketItineraryKey(a));
 for(const id of ['', '../guest','reeltrip-itinerary-v1','__proto__'])assert.throws(()=>bucketItineraryKey(id));
});
test('moving and unscheduling a choice preserve unrelated assignments and notes',()=>{
 const store=memory();assignBucketChoice(store,a,'activity:a','2027-01-02');assignBucketChoice(store,a,'hotel:b','2027-01-03');
 saveBucketDayNote(store,a,'2027-01-02','Lunch time to confirm');
 assignBucketChoice(store,a,'activity:a','2027-01-04');
 assert.equal(read(store).assignments.length,2);assert.equal(read(store).assignments.find(row=>row.interestId==='activity:a').date,'2027-01-04');
 assignBucketChoice(store,a,'activity:a','');assert.deepEqual(read(store).assignments,[{interestId:'hotel:b',date:'2027-01-03'}]);assert.equal(read(store).notes[0].text,'Lunch time to confirm');
});
test('changing trip dates or detaching a choice does not rewrite the saved draft',()=>{
 const store=memory();assignBucketChoice(store,a,'detached-choice','2027-01-02');saveBucketDayNote(store,a,'2027-01-02','Keep this older day');
 const before=store.getItem(bucketItineraryKey(a));
 assert.ok(!bucketItineraryDays({start:'2027-02-01',end:'2027-02-04'}).includes(read(store).assignments[0].date));
 assert.equal(store.getItem(bucketItineraryKey(a)),before);
 assignBucketChoice(store,a,'new-choice','2027-02-02');assert.ok(read(store).assignments.some(row=>row.interestId==='detached-choice'));
});
test('each mutation rereads current state to preserve changes from another tab',()=>{
 const store=memory();const old=read(store);assert.equal(old.assignments.length,0);
 assignBucketChoice(store,a,'activity:remote','2027-01-02');saveBucketDayNote(store,a,'2027-01-03','Local note');
 assert.equal(read(store).assignments[0].interestId,'activity:remote');assert.equal(read(store).notes[0].text,'Local note');
 saveBucketDayNote(store,a,'2027-01-03','');assert.equal(read(store).notes.length,0);assert.equal(read(store).assignments.length,1);
});
test('malformed, future and duplicated stores cannot be overwritten',()=>{
 const valid={version:1,assignments:[{interestId:'a',date:'2027-01-02'}],notes:[{date:'2027-01-02',text:'Keep'}]};
 const invalid=['{bad',JSON.stringify({...valid,version:2}),JSON.stringify({...valid,assignments:[...valid.assignments,...valid.assignments]}),JSON.stringify({...valid,notes:[...valid.notes,...valid.notes]}),JSON.stringify({...valid,assignments:[{interestId:'a',date:'2027-02-30'}]}),JSON.stringify({...valid,notes:[{date:'2027-01-02',text:'x'.repeat(3001)}]}),'x'.repeat(1_000_001)];
 for(const raw of invalid){const store=memory();store.setItem(bucketItineraryKey(a),raw);assert.throws(()=>assignBucketChoice(store,a,'new','2027-01-03'),/kept unchanged/);assert.throws(()=>saveBucketDayNote(store,a,'2027-01-02','New'),/kept unchanged/);assert.equal(store.getItem(bucketItineraryKey(a)),raw);}
});
test('failed writes and bounded assignments never erase a prior draft',()=>{
 const store=memory();assignBucketChoice(store,a,'a','2027-01-02');const before=store.getItem(bucketItineraryKey(a));
 const full={getItem:store.getItem,setItem:()=>{throw new Error('QuotaExceeded');}};
 assert.throws(()=>saveBucketDayNote(full,a,'2027-01-02','Unsaved'),/QuotaExceeded/);assert.equal(store.getItem(bucketItineraryKey(a)),before);
 for(const [id,day] of [['','2027-01-02'],['x'.repeat(1025),'2027-01-02'],['a','invalid']])assert.throws(()=>assignBucketChoice(store,a,id,day));
 assert.equal(store.getItem(bucketItineraryKey(a)),before);
 const assignments=Array.from({length:200},(_,index)=>({interestId:'choice:'+index,date:'2027-01-02'}));
 store.setItem(bucketItineraryKey(a),JSON.stringify({version:1,assignments,notes:[]}));const bounded=store.getItem(bucketItineraryKey(a));
 assert.throws(()=>assignBucketChoice(store,a,'extra','2027-01-02'),/200/);assert.equal(store.getItem(bucketItineraryKey(a)),bounded);
 assignBucketChoice(store,a,'choice:0','');assignBucketChoice(store,a,'extra','2027-01-02');assert.equal(read(store).assignments.length,200);
});
