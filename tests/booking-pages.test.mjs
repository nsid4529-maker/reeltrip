import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookingPages,matchedBookingPage,bookingPageUrl} from '../lib/booking-pages.ts';
import {browseProviderUrl,providerUrl} from '../lib/travel.ts';
const match={id:'dinner',title:'Dinner at The Ivy in the Park',place:'Canary Wharf',category:'Food',source:'test',second:5,quote:'The Ivy in the Park',kind:'Named restaurant',query:'The Ivy in the Park London',providers:['OpenTable']};
const meal={date:'2099-01-03',time:'19:30',covers:4};
test('verified dining links require the full restaurant identity and location',()=>{
 assert.equal(matchedBookingPage(match)?.id,'ivy-in-the-park-london');
 assert.equal(matchedBookingPage({...match,title:'Oudh 1722',query:'Oudh 1722 London',place:'London'})?.provider,'SevenRooms');
 for(const changed of [{title:'The Ivy',query:'The Ivy London'},{place:'New York',query:'The Ivy in the Park New York'},{category:'Stays'},{kind:'Unnamed restaurant'},{kind:'Uncertain name'},{title:'Nearby cafés',query:'Canary Wharf cafes',quote:'The Ivy in the Park'}])assert.equal(matchedBookingPage({...match,...changed}),undefined);
 assert.equal(matchedBookingPage({...match,query:'The Ivy in the Park and Oudh 1722 London'}),undefined);
});
test('OpenTable direct links preserve local date/time/party without session tracking',()=>{
 const u=new URL(bookingPageUrl(bookingPages[1],meal));
 assert.equal(u.origin,'https://www.opentable.co.uk');assert.equal(u.pathname,'/r/the-ivy-in-the-park-london');
 assert.equal(u.searchParams.get('dateTime'),'2099-01-03T19:30');assert.equal(u.searchParams.get('covers'),'4');
 assert.equal(u.searchParams.has('originId'),false);assert.equal(u.searchParams.has('corrid'),false);
});
test('unselected or invalid dining details never create a misleading reservation query',()=>{
 for(const page of bookingPages){assert.equal(bookingPageUrl(page),page.url);
 for(const changed of [{date:'2099-02-30'},{date:'invalid'},{time:'25:00'},{covers:0},{covers:1.5},{covers:21}])assert.equal(bookingPageUrl(page,{...meal,...changed}),page.url);}
});
test('SevenRooms links carry the browser-verified date, party size and local time',()=>{
 const page=bookingPages[0];
 for(const selection of [meal,{date:'2099-01-04',time:'18:00',covers:3}]){
  const u=new URL(bookingPageUrl(page,selection));
  assert.equal(u.origin,'https://www.sevenrooms.com');assert.equal(u.pathname,'/explore/oudh1722/reservations/create/search');
  assert.equal(u.searchParams.get('date'),selection.date);assert.equal(u.searchParams.get('party_size'),String(selection.covers));assert.equal(u.searchParams.get('start_time'),selection.time);
 }
});
test('both GetYourGuide flows preserve Unicode queries and verified referral attribution',()=>{
 const m={...match,query:'Café & temples = Ella? partner_id=attacker #é'};
 const urls=[browseProviderUrl(m,'GetYourGuide'),providerUrl(m,'GetYourGuide',{start:'2099-01-02',end:'2099-01-05'},2,'GBP')];
 for(const value of urls){const u=new URL(value);assert.equal(u.origin,'https://www.getyourguide.com');assert.equal(u.searchParams.get('q'),m.query);assert.deepEqual(u.searchParams.getAll('partner_id'),['EXAMPLE_PARTNER']);assert.equal(u.searchParams.get('cmp'),'reeltrip');assert.equal(u.searchParams.get('utm_medium'),'local_partners');assert.equal(u.hash,'');assert.equal(value.includes('2099'),false);}
});
