import test from 'node:test';
import assert from 'node:assert/strict';
import {createBucket,assignReel,readBuckets,removeBucket} from '../lib/reel-buckets.ts';
test('topic collections persist independently and cannot silently duplicate names',()=>{
 let list=createBucket([],' Japan food ');list=assignReel(list,list[0].id,'one');list=assignReel(list,list[0].id,'one');
 assert.deepEqual(readBuckets(JSON.stringify(list)),list);assert.deepEqual(list[0].reelIds,['one']);
 assert.throws(()=>createBucket(list,'japan FOOD'));assert.equal(removeBucket(list,list[0].id).length,0);
});
test('corrupt entries and deleted reels do not destroy valid collections',()=>{
 let list=createBucket([],'Italy');list=assignReel(list,list[0].id,'keep');list=assignReel(list,list[0].id,'deleted');
 const restored=readBuckets(JSON.stringify([null,...list]),['keep']);assert.equal(restored.length,1);assert.deepEqual(restored[0].reelIds,['keep']);
});
test('collections enforce a bounded number of reels and explicit removal',()=>{
 let list=createBucket([],'Trip');for(let i=0;i<12;i++)list=assignReel(list,list[0].id,String(i));
 assert.throws(()=>assignReel(list,list[0].id,'13'));list=assignReel(list,list[0].id,'0',false);assert.equal(list[0].reelIds.length,11);
});
test('re-assigning a reel a bundle already has, or removing one it lacks, leaves the bundle untouched',()=>{
 let list=createBucket([],'Lisbon');const id=list[0].id;
 list=assignReel(list,id,'a');list=assignReel(list,id,'b');
 const stamped={...list[0],updatedAt:'2026-01-01T00:00:00.000Z'},before=[stamped];
 // A replayed share must not look like a fresh edit, or it can win the iPhone/web merge.
 const again=assignReel(before,id,'a');assert.equal(again[0],stamped);assert.deepEqual(again[0].reelIds,['a','b']);
 const absent=assignReel(before,id,'c',false);assert.equal(absent[0],stamped);
 const real=assignReel(before,id,'c');assert.notEqual(real[0].updatedAt,stamped.updatedAt);assert.deepEqual(real[0].reelIds,['a','b','c']);
});
