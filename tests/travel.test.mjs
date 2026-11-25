import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matches,canonicalKey,validateDates,providerUrl,rankedMatches,viatorSearchBody,diningSelection,validateDining,diningDays} from '../lib/travel.ts';
const dates={start:'2099-01-02',end:'2099-01-05'};
test('canonicalizes aliases and tracking without changing post identity',()=>{assert.equal(canonicalKey('https://instagram.com/reel/DYJiRq2qMuA/?utm_source=x'),canonicalKey('https://www.instagram.com/p/DYJiRq2qMuA'));assert.equal(canonicalKey('https://www.tiktok.com/@person/video/123?x=y'),'tiktok-123');});
test('rejects arbitrary hosts, credentials, profiles, and unsafe schemes',()=>{for(const url of ['https://instagram.com.evil.test/reel/abc','http://instagram.com/reel/abc','https://user@instagram.com/reel/abc','https://instagram.com:123/reel/abc','https://instagram.com/profile','file:///etc/passwd'])assert.throws(()=>canonicalKey(url));});
test('dates reject past, impossible, reversed and excessive windows',()=>{validateDates([dates]);for(const d of [{start:'2020-01-01',end:'2020-01-03'},{start:'2099-02-30',end:'2099-03-05'},{start:'2099-01-02',end:'2099-01-02'},{start:'2099-01-02',end:'2099-03-02'}])assert.throws(()=>validateDates([d]));assert.throws(()=>validateDates([]));assert.throws(()=>validateDates([dates,dates,dates,dates]));});
test('scope never leaks matches from unselected sources',()=>{const result=rankedMatches(['ella'],'safari');assert.ok(result.length);assert.ok(result.every(m=>m.source==='ella'));assert.deepEqual(rankedMatches([],'Ella'),[]);});
test('Booking links include exact party, dates, destination and currency',()=>{const stay=matches.find(m=>m.id==='roys');const u=new URL(providerUrl(stay,'Booking.com',dates,4,'GBP'));assert.equal(u.searchParams.get('ss'),"Roy's Villa Sigiriya");assert.equal(u.searchParams.get('checkin'),dates.start);assert.equal(u.searchParams.get('checkout'),dates.end);assert.equal(u.searchParams.get('group_adults'),'4');assert.equal(u.searchParams.get('selected_currency'),'GBP');});
test('third-party links do not pretend to transfer undocumented date parameters',()=>{const m=matches[1];for(const provider of ['Viator','GetYourGuide']){const u=providerUrl(m,provider,dates,2,'GBP');assert.ok(!u.includes('2099'));assert.ok(!u.startsWith('javascript:'));}});
test('Viator body carries the chosen date window in documented filter',()=>{const body=viatorSearchBody('Ella',dates,'GBP');assert.equal(body.productFiltering.dateRange.from,dates.start);assert.equal(body.productFiltering.dateRange.to,dates.end);assert.equal(body.searchTypes[0].pagination.count,6);});
test('each match is grounded in a source with an explicit distinction',()=>{for(const m of matches){assert.ok(['ella','sigiriya','kanisha','shreya','fitnomads-repeat'].includes(m.source));assert.ok(m.quote&&m.kind);assert.ok(m.second>=0);assert.ok(m.providers.length);}});

test('OpenTable carries exact Unicode venue, restaurant-local meal time and diner count',()=>{
 const m=matches.find(m=>m.id==='cafe-soul');
 const u=new URL(providerUrl(m,'OpenTable',dates,2,'GBP',{date:'2099-01-04',time:'12:30',covers:6}));
 assert.equal(u.origin,'https://www.opentable.com');assert.equal(u.pathname,'/s');
 assert.equal(u.searchParams.get('term'),'Café Soul Ella Sri Lanka');assert.equal(u.searchParams.get('dateTime'),'2099-01-04 12:30');assert.equal(u.searchParams.get('covers'),'6');assert.equal(u.searchParams.get('metroId'),'3401');assert.equal(u.searchParams.has('rid'),false);
});
test('food remains scoped and distinguishes named venues from unnamed area alternatives',()=>{
 const food=matches.filter(m=>m.category==='Food'&&m.source!=='fitnomads-repeat');assert.equal(food.length,3);
 assert.deepEqual(rankedMatches(['ella'],'food').filter(m=>m.category==='Food').map(m=>m.id),['cafe-soul']);
 assert.ok(food.find(m=>m.id==='galle-cafes').kind.includes('unnamed'));
 assert.ok(food.find(m=>m.id==='paradise-breakfast').direct.startsWith('https://'));
});

test('old guest trips gain dining defaults and date-option changes keep the meal inside the trip',()=>{
 const trip={dates:[dates,{start:'2099-02-01',end:'2099-02-04'}],activeDate:0,adults:3};
 assert.deepEqual(diningSelection(trip),{date:'2099-01-02',time:'19:00',covers:3});
 const selected={...trip,diningDate:'2099-01-04',diningTime:'08:30',diners:5};
 assert.equal(diningSelection(selected).date,'2099-01-04');
 assert.deepEqual(diningSelection({...selected,activeDate:1}),{date:'2099-02-01',time:'08:30',covers:5});
 assert.deepEqual(diningDays(dates),['2099-01-02','2099-01-03','2099-01-04','2099-01-05']);
});
test('meal validation rejects dates outside the selected trip, invalid local times and party sizes',()=>{
 const meal={date:'2099-01-03',time:'09:30',covers:2};validateDining(meal,dates);
 for(const changed of [{date:'2099-01-06'},{time:'24:00'},{time:'19:17'},{covers:0},{covers:21},{covers:1.5}])assert.throws(()=>validateDining({...meal,...changed},dates));
});
