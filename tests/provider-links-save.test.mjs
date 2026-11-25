import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerProduct} from '../lib/provider-links-save.ts';
import {INTERESTS_KEY,INTERESTS_LIMIT,changeInterest,importNativeInterests,interestKey,itemForMatch,itemForProviderLink,loadInterests} from '../lib/interested.ts';

const booking='https://www.booking.com/hotel/gb/example-london.en-gb.html?checkin=2027-01-01&token=private#map';
const viator='https://www.viator.com/tours/Amsterdam/Cruise/d525-12345P1';
const gyg='https://www.getyourguide.com/en-gb/amsterdam-l36/cruise-t907734/';
const now='2026-11-18T12:00:00Z';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const share=(n,url=booking,more={})=>({id:id(n),url,title:'My hotel',kind:'hotel',provider:'Booking.com',addedAt:now,...more});
const memory=()=>{let raw=null,writes=0;return {getItem:()=>raw,setItem:(_,value)=>{raw=value;writes++;},raw:value=>raw=value,writes:()=>writes};};

test('classify only specific provider products and discard tracking and fragments',()=>{
 const examples=[
  [booking,'hotel','Booking.com'],[viator,'activity','Viator'],[gyg,'activity','GetYourGuide'],
  ['https://expedia.co.uk/London-Hotels-Example.h12345.Hotel-Information?ref=tracker','hotel','Expedia'],
  ['https://opentable.co.uk/r/the-ivy-in-the-park-london?originId=tracker','restaurant','OpenTable'],
  ['https://sevenrooms.com/explore/oudh1722/reservations/create/search?date=2027-01-01','restaurant','SevenRooms'],
 ];
 for(const [url,kind,provider] of examples){const item=providerProduct(url);assert.equal(item?.kind,kind,url);assert.equal(item.provider,provider);assert.match(new URL(item.url).hostname,/^www\./);assert.equal(new URL(item.url).hash,'');if(provider!=='GetYourGuide')assert.equal(new URL(item.url).search,'');}
 assert.equal(new URL(providerProduct(gyg+'?secret=private').url).searchParams.get('partner_id'),'EXAMPLE_PARTNER');
 assert.equal(new URL(providerProduct(gyg+'?secret=private').url).searchParams.has('secret'),false);
});
test('product identity is stable across translations, titles, locale, domain and tracking variants',()=>{
 for(const [a,b] of [
  [booking,'https://booking.com/hotel/gb/example-london.fr.html'],
  [viator,'https://viator.com/tours/Other/Other/d400-12345P1/?a=b'],
  [gyg,'https://getyourguide.com/other-language-t907734/'],
  ['https://www.expedia.co.uk/Example.h123.Hotel-Information','https://expedia.com/Translation.h123.Hotel-Information?room=2'],
 ])assert.equal(interestKey(itemForProviderLink(a,'First title')),interestKey(itemForProviderLink(b,'Different title')));
});
test('reject searches, redirects, provider lookalikes, local and active-content URLs',()=>{
 const invalid=[
  'https://www.booking.com/searchresults.html?ss=London','https://www.booking.com/Share-abc',
  'https://www.viator.com/Amsterdam/d525-ttd','https://www.getyourguide.com/en-gb/amsterdam-l36/',
  'https://www.expedia.com/Hotel-Search?destination=London','https://www.opentable.com/s?term=London',
  'https://www.sevenrooms.com/explore/oudh1722/','https://gyg.me/abcd',
  'https://www.booking.com.evil.test/hotel/gb/example.html','https://evil.test/hotel/gb/example.html',
  'https://www.booking.com@evil.test/hotel/gb/example.html','https://user@www.booking.com/hotel/gb/example.html',
  'http://www.booking.com/hotel/gb/example.html','https://www.booking.com:8443/hotel/gb/example.html',
  'javascript:alert(1)','https://127.0.0.1/hotel/gb/example.html',
  'https://www.booking.com/hotel/gb/example%2fextra.html',
  'https://www.booking.com/hotel/gb/exa\\mple.html',
 ];
 // Leading/trailing paste whitespace is harmless; embedded controls are not.
 for(const url of invalid)assert.equal(providerProduct(url),null,url);
 assert.equal(providerProduct('https://www.booking.com/ho\ntel/gb/example.html'),null);
 assert.equal(itemForProviderLink(booking,'x'.repeat(241)),null);
 assert.equal(providerProduct(' '+booking+' ')?.kind,'hotel');
});
test('hotels can be saved, reloaded and removed alongside the old version-1 store',()=>{
 const store=memory(),old={kind:'restaurant',title:'Cafe',place:'London',provider:'Place search',url:'https://www.google.com/maps/search/?q=cafe',addedAt:now,id:'ignored'};
 store.raw(JSON.stringify({version:1,items:[old]}));
 const hotel=itemForProviderLink(booking,'London hotel');changeInterest(store,hotel,'add',now);
 assert.equal(loadInterests(store).length,2);assert.equal(loadInterests(store)[0].kind,'hotel');
 changeInterest(store,hotel,'remove');assert.equal(loadInterests(store)[0].title,'Cafe');
 assert.equal(itemForMatch({category:'Stays',title:'A hotel',place:'London',query:'A hotel London',source:'reel',kind:'Named venue'}).kind,'hotel');
});
test('native import classifies from the URL and persists items plus receipts before acknowledging',()=>{
 const store=memory(),entry=share(1,viator,{kind:'hotel',provider:'Spoofed provider',title:'Canal cruise'});
 const result=importNativeInterests(store,[entry]);
 assert.equal(store.writes(),1);assert.deepEqual(result,{acknowledged:[id(1)],added:1,rejected:0,pending:0});
 const [saved]=loadInterests(store);assert.equal(saved.kind,'activity');assert.equal(saved.provider,'Viator');
 assert.deepEqual(JSON.parse(store.getItem(INTERESTS_KEY)).nativeImportIds,[id(1)]);
});
test('native repeats and reloads are idempotent, including after the user removes the item',()=>{
 const store=memory(),entry=share(1);importNativeInterests(store,[entry,entry]);
 const [saved]=loadInterests(store);changeInterest(store,saved,'remove');
 const writes=store.writes(),result=importNativeInterests(store,[entry]);
 assert.equal(loadInterests(store).length,0);assert.equal(result.added,0);assert.deepEqual(result.acknowledged,[id(1)]);assert.equal(store.writes(),writes);
});
test('different import IDs and tracking variants save once without replacing a chosen title',()=>{
 const store=memory();changeInterest(store,itemForProviderLink(booking,'My chosen title'),'add',now);
 const result=importNativeInterests(store,[share(1),share(2,'https://booking.com/hotel/gb/example-london.html')]);
 assert.equal(result.added,0);assert.deepEqual(result.acknowledged,[id(1),id(2)]);assert.equal(loadInterests(store).length,1);assert.equal(loadInterests(store)[0].title,'My chosen title');
});
test('malformed native records and conflicting IDs cannot replace or save a product',()=>{
 const store=memory(),entries=[null,[],{...share(1),id:'not-a-uuid'},{...share(2),addedAt:'yesterday'},share(3,'https://evil.test/'),share(4,booking,{title:'x'.repeat(241)}),share(5,booking,{kind:'script'}),share(6,booking,{provider:null}),share(7),share(7,viator),share(8,booking,{addedAt:'2026-02-30T12:00:00Z'})];
 const result=importNativeInterests(store,entries);assert.equal(result.rejected,entries.length);assert.deepEqual(result.acknowledged,[]);assert.equal(store.writes(),0);
 assert.throws(()=>importNativeInterests(store,{items:[]}));assert.throws(()=>importNativeInterests(store,Array(201).fill(share(1))));
});
test('blocked reads, quota failures and corrupt stores never acknowledge or overwrite',()=>{
 for(const raw of ['{bad',JSON.stringify({version:2,items:[]}),JSON.stringify({version:1,items:[],nativeImportIds:['invalid']})]){
  const store=memory();store.raw(raw);assert.throws(()=>importNativeInterests(store,[share(1)]));assert.equal(store.getItem(),raw);assert.equal(store.writes(),0);
 }
 const store=memory();changeInterest(store,itemForProviderLink(viator),'add',now);const original=store.getItem();
 assert.throws(()=>importNativeInterests({getItem:store.getItem,setItem:()=>{throw new Error('QuotaExceeded');}},[share(1)]),/Quota/);assert.equal(store.getItem(),original);
 assert.throws(()=>importNativeInterests({getItem:()=>{throw new Error('Denied');},setItem:()=>assert.fail('must not write')},[share(1)]),/Denied/);
});
test('full lists preserve pending shares, then import them after space is freed',()=>{
 const store=memory(),items=Array.from({length:INTERESTS_LIMIT},(_,n)=>({kind:'hotel',title:'Hotel '+n,place:'London',provider:'Venue website',url:'https://example.com/hotel/'+n,addedAt:now,id:'ignored'}));
 store.raw(JSON.stringify({version:1,items}));
 assert.deepEqual(importNativeInterests(store,[share(1)]),{acknowledged:[],added:0,pending:1,rejected:0});assert.equal(store.writes(),0);
 changeInterest(store,items[0],'remove');assert.equal(importNativeInterests(store,[share(1)]).added,1);assert.equal(loadInterests(store).length,INTERESTS_LIMIT);
});

test('provider link labels are readable proposals with no invented location or availability',()=>{
 const examples=[
  [viator,'Cruise'],[gyg,'Cruise'],[booking,'Example London'],
  ['https://www.opentable.co.uk/r/the-ivy-in-the-park-london','The Ivy In The Park London'],
  ['https://www.sevenrooms.com/explore/oudh1722/reservations/create/search','Oudh1722'],
 ];
 for(const [url,title] of examples){const item=itemForProviderLink(url);assert.equal(item.title,title);assert.equal(item.titleSource,'link');assert.equal(item.place,'');assert.equal(item.availability,undefined);}
 const custom=itemForProviderLink(viator,'My sunset cruise');assert.equal(custom.title,'My sunset cruise');assert.equal(custom.titleSource,'user');
});

test('saved flight searches preserve supported route and filters, not a claimed flight booking',()=>{
 const flight='https://www.skyscanner.net/transport/flights/lhr/ams/270122/270125/?adultsv2=3&cabinclass=economy&currency=GBP&departure-times=360-720%2C720-1080&tracking=private#price';
 const item=itemForProviderLink(flight),url=new URL(item.url);
 assert.equal(item.kind,'flight');assert.equal(item.provider,'Skyscanner');assert.match(item.title,/LHR → AMS/);
 assert.equal(url.searchParams.get('adultsv2'),'3');assert.equal(url.searchParams.get('currency'),'GBP');assert.equal(url.searchParams.get('cabinclass'),'economy');assert.equal(url.searchParams.get('departure-times'),'360-720,720-1080');
 assert.equal(url.searchParams.has('tracking'),false);assert.equal(url.hash,'');assert.equal(item.availability,undefined);
 assert.equal(interestKey(item),interestKey(itemForProviderLink(flight.replace('tracking=private','tracking=other'),'Custom search')));
 assert.notEqual(interestKey(item),interestKey(itemForProviderLink(flight.replace('adultsv2=3','adultsv2=2'))));
 assert.notEqual(interestKey(item),interestKey(itemForProviderLink(flight.replace('360-720','0-720'))));
 const store=memory();changeInterest(store,item,'add',now);assert.equal(loadInterests(store)[0].url,item.url);
});

test('flight saves reject unsupported searches and invalid filters',()=>{
 const base='https://www.skyscanner.net/transport/flights/lhr/ams/270122/270125/?adultsv2=3&cabinclass=economy&currency=GBP';
 for(const url of [base.replace('270122','270230'),base.replace('270125','270121'),base.replace('/ams/','/lhr/'),base.replace('adultsv2=3','adultsv2=20'),base.replace('economy','unknown'),base.replace('GBP','XYZ'),base+'&adultsv2=2',base+'&departure-times=800-400,0-1439',base+'&departure-times=0-1600,0-1439',base.replace('skyscanner.net','skyscanner.net.evil.test'),base.replace('currency=GBP',''), 'https://www.skyscanner.net/'])assert.equal(providerProduct(url),null,url);
 assert.throws(()=>interestKey({kind:'flight',title:'Fake flight',place:'',provider:'Skyscanner',url:'https://example.com/flights'}));
 assert.equal(importNativeInterests(memory(),[share(1,base)]).rejected,1,'old native imports cannot masquerade as flight selections');
});
