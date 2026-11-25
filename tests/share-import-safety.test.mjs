// Reproduction: a shared link (?share=1) must not erase unreadable saved records.
// Home's share-import path must use the same safe writer as every other library write.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';
import {addReels,LIBRARY_KEY} from '../lib/reel-library.ts';
const catalog=JSON.parse(fs.readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8'));
const [a,b]=catalog.slice(0,2).map(source=>addReels([],[source.source_url])[0]);
const idle={cache:{},restore(){},seedJobs(){},ensure(){}};
async function home(storage,search){
 return componentHarness('app/page.tsx',{globals:browserGlobals({storage,search}),modules:{
  '@/lib/native-library':{nativeLibrary:()=>false},
  '@/components/use-reel-analysis':{useReelAnalysis:()=>idle},
  '@/components/interested':{useInterests:()=>({items:[],contains:()=>false})},
  '@/components/trip-buckets':{useTrips:()=>({activeTrip:null,trips:[]})}}});
}
test('sharing a link keeps an unreadable saved record instead of silently deleting it',async t=>{
 const storage=memoryStorage();
 // One valid reel plus one record this version cannot read (e.g. written by a newer version).
 const unreadable={id:'future-record',url:'https://example.invalid/x',addedAt:'2026-11-01T00:00:00.000Z',futureField:true};
 const before=JSON.stringify([a,unreadable]);
 storage.setItem(LIBRARY_KEY,before);
 const h=await home(storage,'?share=1&url='+encodeURIComponent(b.url));
 t.after(()=>h.unmount());await h.flush();
 const after=storage.getItem(LIBRARY_KEY);
 assert.ok(after.includes('future-record')||after===before,'unreadable record was erased by the share import');
});
test('sharing a link into a readable library still saves it',async t=>{
 const storage=memoryStorage();storage.setItem(LIBRARY_KEY,JSON.stringify([a]));
 const h=await home(storage,'?share=1&url='+encodeURIComponent(b.url));
 t.after(()=>h.unmount());await h.flush();
 assert.equal(JSON.parse(storage.getItem(LIBRARY_KEY)).some(r=>r.id===b.id),true);
});
