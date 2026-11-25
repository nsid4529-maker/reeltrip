import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INTERESTS_KEY,INTERESTS_LIMIT,changeInterest,interestKey,interestUrl,itemForGetYourGuide,itemForMatch,loadInterests,readInterests} from '../lib/interested.ts';
import {AMSTERDAM_CRUISE} from '../lib/getyourguide.ts';

const now='2026-11-18T12:00:00.000Z';
const restaurant={kind:'restaurant',title:'Café Soul',place:'Ella',provider:'Place search',url:'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9+Soul+Ella'};
const activity={kind:'activity',title:'Cruise',place:'Amsterdam',provider:'Viator',url:'https://www.viator.com/tours/Amsterdam/Cruise/d525-12345P1?pid=partner'};
const memory=()=>{let raw=null;return {getItem:k=>{assert.equal(k,INTERESTS_KEY);return raw;},setItem:(k,v)=>{assert.equal(k,INTERESTS_KEY);raw=v;},raw:v=>raw=v};};

test('save, reload and remove interests without losing unrelated places',()=>{
 const store=memory();changeInterest(store,restaurant,'add',now);changeInterest(store,activity,'add',now);
 assert.equal(loadInterests(store).length,2);
 const after=changeInterest(store,restaurant,'remove');assert.equal(after.length,1);assert.equal(after[0].title,'Cruise');assert.deepEqual(loadInterests(store),after);
});
test('provider product identities deduplicate tracking URLs and translated paths',()=>{
 const first=itemForGetYourGuide(AMSTERDAM_CRUISE,'Amsterdam cruise'),other=itemForGetYourGuide('https://www.getyourguide.com/amsterdam-l36/other-title-t907734/?tracking=ignored','Different label');
 assert.equal(interestKey(first),interestKey(other));
 const store=memory();changeInterest(store,first,'add',now);changeInterest(store,other,'add',now);assert.equal(loadInterests(store).length,1);
 assert.equal(interestKey(activity),interestKey({...activity,url:'https://www.viator.com/tours/Other/Other/d525-12345P1?changed=true'}));
 assert.notEqual(interestKey(activity),interestKey({...activity,url:'https://www.viator.com/tours/Other/Other/d525-12345P2'}));
});
test('a failed write never returns a successful saved list or changes existing data',()=>{
 const store=memory();changeInterest(store,restaurant,'add',now);const original=store.getItem(INTERESTS_KEY);
 const blocked={getItem:store.getItem,setItem:()=>{throw new Error('QuotaExceededError');}};
 assert.throws(()=>changeInterest(blocked,activity),/Quota/);assert.equal(store.getItem(INTERESTS_KEY),original);
});
test('unreadable or future-version storage is kept unchanged on attempted mutations',()=>{
 for(const raw of ['{bad',JSON.stringify({version:2,items:[]}),JSON.stringify({version:1,items:'wrong'})]){
  const store=memory();store.raw(raw);assert.deepEqual(readInterests(raw),[]);assert.throws(()=>changeInterest(store,restaurant));assert.equal(store.getItem(INTERESTS_KEY),raw);
 }
 const denied={getItem:()=>{throw new Error('SecurityError');},setItem:()=>assert.fail('Must not write after failed read')};
 assert.throws(()=>changeInterest(denied,restaurant),/Security/);
});
test('one corrupt saved record does not hide unrelated valid records or trust supplied IDs',()=>{
 const store=memory();const [valid]=changeInterest(store,restaurant,'add',now);
 store.raw(JSON.stringify({version:1,items:[{...valid,url:'javascript:alert(1)'},{...valid,id:'forged'}]}));
 const items=loadInterests(store);assert.equal(items.length,1);assert.equal(items[0].id,interestKey(restaurant));
 changeInterest(store,activity,'add',now);assert.equal(loadInterests(store).length,2);
});
test('reject active content, credentials, local targets and oversized values',()=>{
 for(const url of ['javascript:alert(1)','http://www.viator.com/','https://user:pass@example.com/','https://127.0.0.1/','https://[::1]/','https://localhost/','https://router.local/','https://internal.internal/','https://example.com:8443/','https://example.com/\nattack'])assert.equal(interestUrl(url),null,url);
 assert.throws(()=>interestKey({...restaurant,title:'a'.repeat(241)}));
 assert.throws(()=>interestKey({...restaurant,kind:'unapproved'}));
 assert.equal(interestUrl('https://example.com/path#tracking'),'https://example.com/path');
});
test('each mutation reads current storage so separate views preserve previous saves',()=>{
 const store=memory();const stale=loadInterests(store);assert.deepEqual(stale,[]);
 changeInterest(store,restaurant,'add',now);changeInterest(store,activity,'add',now);
 assert.deepEqual(new Set(loadInterests(store).map(i=>i.title)),new Set(['Café Soul','Cruise']));
});
test('list capacity rejects a new save while allowing removal',()=>{
 const store=memory();const items=Array.from({length:INTERESTS_LIMIT},(_,i)=>({...restaurant,title:'Restaurant '+i,id:'ignored',addedAt:now}));
 store.raw(JSON.stringify({version:1,items}));assert.throws(()=>changeInterest(store,activity,'add',now),/200 places/);assert.equal(loadInterests(store).length,INTERESTS_LIMIT);
 changeInterest(store,items[0],'remove');assert.equal(loadInterests(store).length,INTERESTS_LIMIT-1);
});
test('reel match interests retain source and only exact verified venues use reservation pages',()=>{
 const base={id:'test',title:'The Ivy in the Park',place:'London',query:'The Ivy in the Park London',category:'Food',kind:'Named venue',source:'reel1',second:0,quote:'',providers:[]};
 const exact=itemForMatch(base);assert.equal(exact.provider,'OpenTable');assert.equal(exact.sourceId,'reel1');
 const uncertain=itemForMatch({...base,kind:'Uncertain name'});assert.equal(uncertain.provider,'Place search');assert.equal(new URL(uncertain.url).hostname,'www.google.com');
 assert.equal(itemForMatch({...base,title:'Café',query:'Café London',direct:'javascript:alert(1)'}).provider,'Place search');
});
test('GetYourGuide interests require an individual product and never carry arbitrary tracking',()=>{
 for(const url of ['https://www.getyourguide.com/s/?q=Amsterdam','https://evil.test/activity-t907734/','https://www.getyourguide.com@evil.test/activity-t907734/'])assert.equal(itemForGetYourGuide(url),null);
 const item=itemForGetYourGuide(AMSTERDAM_CRUISE+'?secret=value','Cruise');assert.equal(item.title,'Cruise');assert.equal(new URL(item.url).searchParams.has('secret'),false);assert.equal(new URL(item.url).searchParams.get('partner_id'),'EXAMPLE_PARTNER');
});
