import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPreparation,prepareSpecialists,preparationMeal,preparationStorageKey,readPreparation,routeSpecialistIntent,specialistDestinationLinks,updatePreparation} from '../lib/booking-specialists.ts';
import {interestKey,itemForMatch} from '../lib/interested.ts';
const prefs={name:'Coast',destination:'Ahangama',dates:[{start:'2099-02-10',end:'2099-02-14'}],activeDate:0,adults:4,currency:'EUR',brief:'Quiet rooms and vegetarian food'};
const source=id=>({id,title:'Coast ideas',source_url:'https://www.instagram.com/reel/'+id+'/',creator:'Traveller',scope:'Travel ideas',unknowns:['Availability unknown'],days:[]});
const match=(id,category,extra={})=>({id,source:'coast',title:category==='Food'?'Kai Ahangama':category==='Stays'?'Coast hotel':'Coast experience',place:'Ahangama',query:category==='Food'?'Kai Ahangama':'Coast '+id+' Ahangama',category,quote:'The creator mentions this option',second:12,kind:'Named place',providers:[],...extra});
const analysis=matches=>({source:source('coast'),matches});
const interest=input=>({...input,id:interestKey(input),addedAt:'2026-11-18T12:00:00Z'});
const saved=kind=>interest({kind,title:'Saved '+kind,place:'Ahangama',provider:'Saved website',url:'https://example.com/'+kind});
const trip='11111111-1111-4111-8111-111111111111',otherTrip='22222222-2222-4222-8222-222222222222';
const memory=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('clear specialist requests route inside one chat; flights, unrelated questions and negation do not',()=>{
 assert.deepEqual(routeSpecialistIntent('Prepare hotel options'),['hotel']);
 assert.deepEqual(routeSpecialistIntent('Find restaurants and activities for this bucket'),['restaurant','activity']);
 assert.deepEqual(routeSpecialistIntent('Show booking options'),['hotel','restaurant','activity']);
 assert.deepEqual(routeSpecialistIntent('Prepare restaurant booking options to compare'),['restaurant']);
 for(const request of ['Find flights','What does the reel say?','Do not book hotels',"Don’t shortlist restaurants",'Compare cafés','Compare these cafés and restaurants','Compare these experiences','Compare hotel booking options','Shortlist restaurants from these reels'] )assert.deepEqual(routeSpecialistIntent(request),[]);
});
test('specialists use supplied scoped sources, distinguish actual categories, and preserve evidence',()=>{
 const hotel=match('hotel','Stays'),restaurant=match('food','Food'),activity=match('activity','Experiences'),transport=match('flight','Transport'),wrongSource=match('foreign','Stays',{source:'another-bucket'});
 const inputs={analyses:[analysis([hotel,restaurant,activity,transport,wrongSource])],interests:[],preferences:prefs},before=structuredClone(inputs),cards=prepareSpecialists(inputs);
 assert.deepEqual(cards.map(card=>card.specialist),['hotel','restaurant','activity']);
 assert.ok(cards.every(card=>card.status==='Suggested'&&card.source.id==='coast'));
 assert.equal(cards[0].match.quote,hotel.quote);assert.equal(cards[0].match.second,12);assert.deepEqual(inputs,before);
 assert.ok(cards.every(card=>!('price' in card)&&!('bookingReference' in card)&&!('availability' in card)));
});
test('saving a source choice produces one shortlisted card; valid details prepare it without booking it',()=>{
 const hotel=match('hotel','Stays'),item=interest(itemForMatch(hotel));
 const cards=prepareSpecialists({analyses:[analysis([hotel])],interests:[item],preferences:prefs});
 assert.equal(cards.length,1);assert.equal(cards[0].status,'Ready to open');assert.equal(cards[0].item.id,item.id);assert.equal(cards[0].shortlisted,true);
 const booking=new URL(cards[0].links.find(link=>link.provider==='Booking.com').url),expedia=new URL(cards[0].links.find(link=>link.provider==='Expedia').url);
 assert.equal(booking.searchParams.get('checkin'),prefs.dates[0].start);assert.equal(booking.searchParams.get('group_adults'),'4');assert.equal(booking.searchParams.get('selected_currency'),'EUR');assert.equal(expedia.searchParams.get('endDate'),prefs.dates[0].end);assert.equal(expedia.searchParams.has('currency'),false);
 assert.match(cards[0].links[0].notice,/not an exact room match/);
});
test('restaurant preparation requires explicit local time; uncertain source names never become verified matches',()=>{
 const food=match('kai','Food'),item=interest(itemForMatch(food)),inputs={analyses:[analysis([food])],interests:[item],preferences:prefs};
 assert.equal(prepareSpecialists(inputs)[0].status,'Shortlisted');
 const state={...emptyPreparation(),diningTime:'18:30',diningDate:'2099-02-12'},card=prepareSpecialists({...inputs,state})[0];
 assert.equal(card.status,'Ready to open');assert.deepEqual(card.meal,{date:'2099-02-12',time:'18:30',covers:4});assert.ok(card.links.some(link=>link.url==='https://mytable.lk/venues/63'));
 const uncertain={...food,kind:'Unverified restaurant'};
 const unconfirmed=prepareSpecialists({...inputs,analyses:[analysis([uncertain])],state})[0];
 assert.ok(unconfirmed.links.every(link=>link.kind!=='venue'));
 assert.deepEqual(preparationMeal({...prefs,dates:[{start:'2099-03-01',end:'2099-03-03'}]},state),{date:'2099-03-01',time:'18:30',covers:4});
});
test('invalid or missing bucket dates keep saved options short-listed and original links intact',()=>{
 for(const dates of [[{start:'',end:''}],[{start:'2020-01-01',end:'2020-01-03'}],[{start:'2099-02-30',end:'2099-03-02'}],[{start:'2099-02-10',end:''}]]){
  const card=prepareSpecialists({analyses:[],interests:[saved('hotel')],preferences:{...prefs,dates}})[0];
  assert.equal(card.status,'Shortlisted');assert.ok(card.missing.length);assert.ok(card.links.some(link=>link.label==='Open original saved provider page'));assert.ok(!card.links.some(link=>link.provider==='Booking.com'));
 }
 const day=prepareSpecialists({analyses:[],interests:[saved('activity')],preferences:{...prefs,dates:[{start:'2099-02-10',end:''}]}})[0];assert.equal(day.status,'Ready to open');
});
test('activity handoff preserves exact GetYourGuide identity and uses current bucket guests and dates',()=>{
 const item=interest({kind:'activity',title:'Cruise',place:'Amsterdam',provider:'GetYourGuide',url:'https://www.getyourguide.com/amsterdam-l36/cruise-t907734/?date_from=2099-01-01&_pc=1,2'}),card=prepareSpecialists({analyses:[],interests:[item],preferences:prefs})[0];
 const current=new URL(card.links.find(link=>link.label==='Open with selected date & guests').url);
 assert.equal(current.pathname.replace(/\/$/,''),'/amsterdam-l36/cruise-t907734');assert.equal(current.searchParams.get('date_from'),'2099-02-10');assert.equal(current.searchParams.get('_pc'),'1,4');
 assert.ok(card.links.some(link=>link.url===item.url));assert.equal(card.status,'Ready to open');
});
test('failures stay visible with choices; invalid saved links are retained but never made clickable',()=>{
 const item={...saved('hotel'),url:'javascript:alert(1)'},id='saved:'+item.id;
 const invalid=prepareSpecialists({analyses:[],interests:[item],preferences:prefs})[0];assert.equal(invalid.status,'Needs attention');assert.match(invalid.problem,/invalid/);assert.ok(invalid.links.every(link=>link.url!==item.url));
 const reported=prepareSpecialists({analyses:[],interests:[saved('hotel')],preferences:prefs,state:{...emptyPreparation(),problems:{[id]:'Provider page did not open'}}})[0];
 assert.equal(reported.status,'Needs attention');assert.match(reported.problem,/You reported/);assert.ok(reported.links.length>0);
});
test('no evidence produces labelled destination handoffs, not invented hotel or activity cards',()=>{
 assert.deepEqual(prepareSpecialists({analyses:[],interests:[],preferences:prefs}),[]);
 const hotels=specialistDestinationLinks('hotel',prefs);assert.equal(hotels.length,3);assert.ok(hotels.every(link=>link.kind==='search'&&/not a suggested property/.test(link.notice)));
 assert.equal(new URL(hotels[0].url).searchParams.get('ss'),'Ahangama');
 const restaurants=specialistDestinationLinks('restaurant',prefs);assert.ok(restaurants.length>0);assert.ok(restaurants.every(link=>link.kind==='search'));
 const activities=specialistDestinationLinks('activity',prefs);const route=new URL(activities[0].url,'https://reeltrip.example');assert.equal(route.pathname,'/activities');assert.equal(route.searchParams.get('adults'),'4');assert.equal(route.searchParams.get('start'),'2099-02-10');
 assert.deepEqual(specialistDestinationLinks('hotel',{...prefs,destination:''}),[]);
});
test('preparation state survives reload and sequential updates, is isolated by bucket, and clears only explicitly',()=>{
 const storage=memory();updatePreparation(storage,trip,{diningDate:'2099-02-11',diningTime:'19:30'});updatePreparation(storage,trip,{problem:{id:'source:coast:hotel',reason:'Coast hotel: Provider page did not open'}});updatePreparation(storage,trip,{diningTime:'20:00'});
 let state=readPreparation(storage.getItem(preparationStorageKey(trip)));assert.equal(state.diningDate,'2099-02-11');assert.equal(state.diningTime,'20:00');assert.equal(Object.keys(state.problems).length,1);
 assert.deepEqual(readPreparation(storage.getItem(preparationStorageKey(otherTrip))),emptyPreparation());
 assert.equal(prepareSpecialists({analyses:[],interests:[],preferences:prefs,state}).length,0);assert.equal(Object.keys(state.problems).length,1);
 updatePreparation(storage,trip,{problem:{id:'source:coast:hotel',reason:null}});state=readPreparation(storage.getItem(preparationStorageKey(trip)));assert.deepEqual(state.problems,{});assert.equal(state.diningTime,'20:00');
});
test('corrupt, unsafe or unwritable preparation storage is never overwritten or reported as saved',()=>{
 const storage=memory(),key=preparationStorageKey(trip);storage.values.set(key,'{corrupt');assert.throws(()=>updatePreparation(storage,trip,{diningTime:'18:00'}),/kept unchanged/);assert.equal(storage.getItem(key),'{corrupt');
 for(const patch of [{diningDate:'2099-02-30'},{diningTime:'25:00'},{problems:[]},{problems:{bad:''}},{problems:JSON.parse('{"__proto__":"bad"}')},{version:2}])assert.throws(()=>readPreparation(JSON.stringify({...emptyPreparation(),...patch})));
 assert.throws(()=>preparationStorageKey('../other'));assert.throws(()=>updatePreparation(memory(),trip,{problem:{id:'constructor',reason:'bad'}}));
 const quota={getItem:()=>JSON.stringify(emptyPreparation()),setItem:()=>{throw new Error('Storage full');}};assert.throws(()=>updatePreparation(quota,trip,{diningTime:'18:00'}),/Storage full/);
});
