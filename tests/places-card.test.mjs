import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedLabel,personalFixes,savePersonalFix,withPersonalFix,resolvePlace,venue,PLACE_FIXES_KEY} from '../lib/places-client.ts';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';

const DAY=86400000;
const view=(extra={})=>({key:'sunrise',status:'possible',confidence:'low',placeId:'fixture_pidurangala',provider:'fixture',lat:1,lng:2,checkedAt:Date.now()-3*DAY,fixedBy:null,fixed:false,...extra});

test('a renamed place at the same position reloads its match and discards an earlier response',async()=>{
 const real=await import('../lib/places-client.ts');let finishOld;const old=new Promise(resolve=>{finishOld=resolve;}),requested=[];
 const place={key:'renamed-card',title:'Old venue',place:'Kyoto'};
 const h=await componentHarness('components/place-match.tsx',{exportName:'PlaceMatch',props:{place,bucketId:'rename-bucket'},modules:{'@/lib/places-client':{...real,resolvePlace:input=>{requested.push(input.title);return input.title==='Old venue'?old:Promise.resolve(view({key:place.key,status:'unmatched',confidence:'none',placeId:null}));}}}});
 await h.flush();h.render({place:{...place,title:'New venue'},bucketId:'rename-bucket'});await h.flush();
 assert.match(h.text(),/No matching venue found/);
 finishOld(view({key:place.key,status:'matched',confidence:'high',placeId:'fixture_old_venue'}));await h.flush();
 assert.match(h.text(),/No matching venue found/);assert.doesNotMatch(h.text(),/Show venue/);
 assert.deepEqual(requested,['Old venue','New venue']);h.unmount();
});

test('"last checked" reads as days ago, with the exact date available',()=>{
 const now=Date.UTC(2026,10,22,12);
 assert.equal(checkedLabel(now-3*DAY,now).relative,'3 days ago');
 assert.equal(checkedLabel(now-1000,now).relative,'today');assert.equal(checkedLabel(now-DAY,now).relative,'yesterday');
 assert.match(checkedLabel(now-3*DAY,now).exact,/19 November 2026/);
 assert.equal(checkedLabel(null),null);
});

test('personal fixes keep only the place id and our own data, and survive damaged storage',()=>{
 const storage=memoryStorage({[PLACE_FIXES_KEY]:'{broken'});
 assert.deepEqual(personalFixes(storage),{});
 savePersonalFix(storage,'sunrise',{placeId:'fixture_pidurangala',provider:'fixture',notAPlace:false,fixedAt:5});
 savePersonalFix(storage,'roys',{placeId:null,provider:null,notAPlace:true,fixedAt:6});
 assert.deepEqual(Object.keys(JSON.parse(storage.getItem(PLACE_FIXES_KEY)).sunrise).sort(),['fixedAt','notAPlace','placeId','provider']);
 storage.setItem(PLACE_FIXES_KEY,JSON.stringify({x:{placeId:'javascript:alert(1)',notAPlace:false,fixedAt:1}}));
 assert.deepEqual(personalFixes(storage),{},'malformed place ids are ignored');
 const fixed=withPersonalFix(view(),{placeId:'fixture_pidurangala',provider:'fixture',notAPlace:false,fixedAt:7});
 assert.deepEqual([fixed.status,fixed.confidence,fixed.fixedBy.name,fixed.checkedAt],['matched','confirmed','you',7]);
 const notAPlace=withPersonalFix(view(),{placeId:null,provider:null,notAPlace:true,fixedAt:7});
 assert.equal(notAPlace.status,'not_a_place');assert.equal(notAPlace.checkedAt,null,'marking a non-place is not a provider check');
});

test('places shown together are matched in one request',async()=>{
 const sent=[],original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);sent.push(body);return Response.json({places:body.places.map(p=>view({key:p.key}))});};
 try{
  const [a,b]=await Promise.all([resolvePlace({key:'batch-a',title:'A',place:'Ella'}),resolvePlace({key:'batch-b',title:'B',place:'Ella'})]);
  assert.deepEqual([a.key,b.key],['batch-a','batch-b']);assert.equal(sent.length,1);
  await resolvePlace({key:'batch-a',title:'A',place:'Ella'});assert.equal(sent.length,1,'resolved places are reused on the page');
 }finally{globalThis.fetch=original;}
});

test('map and venue cards reuse a live details request within the page',async()=>{
 const calls=[],original=globalThis.fetch;
 globalThis.fetch=async url=>{calls.push(url);return Response.json({id:'fixture_live_details',name:'Sample venue',address:'Ella',mapsUri:'',provider:'fixture',lat:6.8,lng:81});};
 try{
  const [map,card]=await Promise.all([venue('fixture_live_details'),venue('fixture_live_details')]);
  assert.equal(calls.length,1);assert.deepEqual(map,card);assert.equal(map.lat,6.8);
  await venue('fixture_live_details');assert.equal(calls.length,1,'reopening a venue uses page memory rather than another provider call');
 }finally{globalThis.fetch=original;}
});

// The card, with its network helpers replaced.
async function card({bucketId,current=view(),session=memoryStorage(),fixShared=async()=>view({status:'matched',confidence:'confirmed',fixed:true})}={}){
 const tracked=[],fixes=[],storage=memoryStorage();
 const real=await import('../lib/places-client.ts');
 const modules={'@/lib/track':{track:(...a)=>tracked.push(a)},'@/lib/places-client':{...real,
  resolvePlace:async()=>current,venue:async id=>({id,name:'Pidurangala Rock',address:'Sigiriya (sample data)',mapsUri:'',provider:'fixture'}),
  searchVenues:async()=>[{id:'fixture_pidurangala',name:'Pidurangala Rock',address:'Sigiriya'}],fixShared:async(...a)=>{fixes.push(a);return fixShared(...a);},forgetPlace(){}}};
 const globals=browserGlobals({storage,session});
 const h=await componentHarness('components/place-match.tsx',{modules,globals,exportName:'PlaceMatch',props:{place:{key:'sunrise',title:'Pidurangala at sunrise',place:'Sigiriya',kind:'Place named in video',category:'Experiences'},bucketId,source:{url:'https://www.tiktok.com/@jenseymour0/video/1',creator:'jenseymour0',second:65}}});
 await h.flush();return {h,tracked,fixes,storage,session};
}
const button=(h,label)=>h.elements(n=>n.type==='button'&&h.text(n).includes(label))[0];

test('the card shows the confidence, last checked, source reel, creator and timestamp',async()=>{
 const {h}=await card();const text=h.text();
 assert.match(text,/Possible match — confirm\?/);assert.match(text,/Last checked 3 days ago/);assert.match(text,/@jenseymour0 at 1:05/);
 const time=h.elements(n=>n.type==='time')[0];assert.match(time.props.title,/\d{4}/,'exact date on hover');
});

test('place_viewed counts a deliberate venue open once per bucket and browser session',async()=>{
 const session=memoryStorage(),first=await card({bucketId:'bucket-a',session});
 assert.deepEqual(first.tracked,[],'rendering a place does not count as opening it');
 button(first.h,'See the possible venue').props.onClick();await first.h.flush();
 assert.deepEqual(first.tracked.map(([name,props,id])=>[name,props.placeId,id]),[['place_viewed','sunrise','bucket-a']]);
 button(first.h,'Hide venue').props.onClick();await first.h.flush();
 button(first.h,'See the possible venue').props.onClick();await first.h.flush();
 assert.equal(first.tracked.length,1,'closing and reopening does not count twice');
 const again=await card({bucketId:'bucket-a',session});button(again.h,'See the possible venue').props.onClick();await again.h.flush();
 assert.deepEqual(again.tracked,[],'another card shares the same session deduplication');
 const other=await card({bucketId:'bucket-b',session});button(other.h,'See the possible venue').props.onClick();await other.h.flush();
 assert.equal(other.tracked.length,1,'the same place can be inspected in another bucket');
 const fresh=await card({bucketId:'bucket-a'});button(fresh.h,'See the possible venue').props.onClick();await fresh.h.flush();
 assert.equal(fresh.tracked.length,1,'a fresh browser session counts a new open');
});

test('opening Fix it counts an unmatched place as inspected',async()=>{
 const {h,tracked}=await card({bucketId:'bucket-a',current:view({status:'unmatched',placeId:null})});
 assert.deepEqual(tracked,[]);
 button(h,'Fix it').props.onClick();await h.flush();
 assert.deepEqual(tracked.map(([name,props,id])=>[name,props.placeId,id]),[['place_viewed','sunrise','bucket-a']]);
 button(h,'Cancel').props.onClick();await h.flush();
 button(h,'Fix it').props.onClick();await h.flush();
 assert.equal(tracked.length,1);
});

test('blocked session storage never prevents a venue from opening',async()=>{
 const {h,tracked}=await card();
 Object.defineProperty(h.globals.window,'sessionStorage',{get(){throw new Error('Storage blocked');}});
 button(h,'See the possible venue').props.onClick();await h.flush();
 assert.match(h.text(),/Pidurangala Rock/);assert.deepEqual(tracked,[]);
});

test('one tap confirms a possible match on this device, and the venue is shown with its source label',async()=>{
 const {h,storage}=await card();
 button(h,'See the possible venue').props.onClick();await h.flush();
 assert.match(h.text(),/Pidurangala Rock/);assert.equal(h.elements(n=>n.props?.provider==='fixture'&&'mapsUri' in n.props).length,1,'the venue carries its source label');
 await button(h,'Yes, that’s the place').props.onClick();await h.flush();
 assert.equal(JSON.parse(storage.getItem(PLACE_FIXES_KEY)).sunrise.placeId,'fixture_pidurangala');
});

test('in a shared bucket, Fix it sends the fix for everyone; Not a real place is one tap',async()=>{
 const {h,fixes}=await card({bucketId:'00000000-0000-4000-8000-0000000000f1'});
 button(h,'Fix it').props.onClick();await h.flush();
 await h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
 await h.elements(n=>n.type==='button'&&h.text(n).includes('Sigiriya'))[0].props.onClick();await h.flush();
 assert.equal(JSON.stringify(fixes[0]),JSON.stringify(['00000000-0000-4000-8000-0000000000f1','sunrise',{placeId:'fixture_pidurangala'}]));
 button(h,'Fix it').props.onClick();await h.flush();
 await button(h,'Not a real place').props.onClick();await h.flush();
 assert.equal(JSON.stringify(fixes[1][2]),JSON.stringify({notAPlace:true}));
 assert.match(h.text(),/Fixed for everyone in this bucket/);
});

test('unnamed venues offer no Fix it and no venue, and say so',async()=>{
 const {h}=await card({current:view({status:'not_a_venue',confidence:'none',placeId:null,checkedAt:Date.now()})});
 assert.match(h.text(),/No venue named in the reel/);assert.equal(button(h,'Fix it'),undefined);assert.equal(button(h,'Show venue'),undefined);
});

test('classification and unsuccessful lookup timestamps are never presented as venue checks',async()=>{
 for(const status of ['not_a_venue','not_a_place','unmatched','not_checked']){
  const {h}=await card({current:view({status,confidence:'none',placeId:null,provider:null,checkedAt:Date.now()})});
  assert.doesNotMatch(h.text(),/Last checked/,status);
 }
 const {h}=await card({current:view({status:'matched',placeId:null,provider:null})});
 assert.doesNotMatch(h.text(),/Last checked/,'a venue ID and provider are required');
});

test('Google data is attributed "Google Maps" and links to its Maps page; sample data says so',async()=>{
 const render=props=>componentHarness('components/place-match.tsx',{expose:['Attribution'],exportName:'Attribution',props,modules:{'@/lib/track':{track(){}}}});
 const google=await render({provider:'google',mapsUri:'https://maps.google.com/?cid=1'});
 assert.equal(google.text(),'Google Maps');assert.equal(google.tree.props.href,'https://maps.google.com/?cid=1');
 assert.equal((await render({provider:'google',mapsUri:''})).text(),'Google Maps');
 assert.match((await render({provider:'fixture',mapsUri:''})).text(),/Sample data/);
});
