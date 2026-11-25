import test from 'node:test';
import assert from 'node:assert/strict';
import {addReels,LIBRARY_KEY} from '../lib/reel-library.ts';
import {BUCKETS_KEY} from '../lib/reel-buckets.ts';
import {importNativeShares,bundleCatalog} from '../lib/native-share.ts';
import {updateBundles} from '../lib/reel-import.ts';
import {memoryStorage} from './helpers/component-harness.mjs';

// C1: the web page's bundles must merge with the iPhone's, never replace them.
const reels=addReels([],['https://www.instagram.com/reel/MergeOne01/','https://www.instagram.com/reel/MergeTwo02/']);
const id=n=>'00000000-0000-4000-8000-00000000000'+n;
const at=minutes=>new Date(Date.UTC(2026,10,21,9,minutes)).toISOString();
const web=(n,name,reelIds,updatedAt)=>({id:id(n),name,reelIds,createdAt:at(0),...(updatedAt?{updatedAt}:{})});
const phone=(n,name,urls,updatedAt)=>({id:id(n),name,urls,createdAt:at(0),...(updatedAt?{updatedAt}:{})});
function storageWith(bundles){
 const storage=memoryStorage();storage.setItem(LIBRARY_KEY,JSON.stringify(reels));storage.setItem(BUCKETS_KEY,JSON.stringify(bundles));return storage;
}
const nativeData=bundles=>({videos:reels.map(({url,addedAt})=>({url,addedAt})),bundles,pendingShares:[]});
const saved=storage=>JSON.parse(storage.getItem(BUCKETS_KEY));

test('a bundle that only the iPhone has is kept when the web page already has bundles',()=>{
 const storage=storageWith([web(1,'Lisbon food',[reels[0].id],at(5))]);
 importNativeShares(storage,nativeData([phone(1,'Lisbon food',[reels[0].url],at(5)),phone(2,'Porto day trip',[reels[1].url],at(6))]),()=>{});
 assert.deepEqual(saved(storage).map(b=>b.name).sort(),['Lisbon food','Porto day trip']);
 assert.deepEqual(saved(storage).find(b=>b.id===id(2)).reelIds,[reels[1].id]);
});

test('for the same bundle on both sides, the newer edit wins',()=>{
 const storage=storageWith([web(1,'Lisbon',[reels[0].id],at(5))]);
 importNativeShares(storage,nativeData([phone(1,'Lisbon',[reels[0].url,reels[1].url],at(9))]),()=>{});
 assert.deepEqual(saved(storage)[0].reelIds,[reels[0].id,reels[1].id],'the iPhone copy is newer');
 const older=storageWith([web(1,'Lisbon',[reels[0].id,reels[1].id],at(9))]);
 importNativeShares(older,nativeData([phone(1,'Lisbon',[reels[0].url],at(5))]),()=>{});
 assert.deepEqual(saved(older)[0].reelIds,[reels[0].id,reels[1].id],'the web copy is newer');
});

test('without timestamps on either side, the web copy wins and nothing is dropped',()=>{
 const storage=storageWith([web(1,'Web name',[reels[0].id])]);
 importNativeShares(storage,nativeData([phone(1,'Phone name',[reels[1].url]),phone(3,'Phone only',[])]),()=>{});
 assert.deepEqual(saved(storage).map(b=>b.name),['Web name','Phone only']);
});

test('a bundle deleted on the web is not brought back by a stale iPhone copy',()=>{
 const storage=storageWith([web(1,'Keep',[],at(1)),web(2,'Delete me',[],at(1))]);
 updateBundles(storage,current=>current.filter(b=>b.id!==id(2)));
 importNativeShares(storage,nativeData([phone(1,'Keep',[],at(1)),phone(2,'Delete me',[],at(1))]),()=>{});
 assert.deepEqual(saved(storage).map(b=>b.name),['Keep']);
});

test('edits stamp updatedAt and the iPhone catalogue carries it',()=>{
 const storage=storageWith([web(1,'Lisbon',[],at(1))]);
 const next=updateBundles(storage,current=>current.map(b=>({...b,reelIds:[reels[0].id]})));
 assert.ok(Date.parse(next[0].updatedAt)>Date.parse(at(1)));
 assert.equal(bundleCatalog(next,reels)[0].updatedAt,next[0].updatedAt);
});
