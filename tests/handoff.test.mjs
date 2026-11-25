import test from 'node:test';
import assert from 'node:assert/strict';
import {stayLinks,stayArea,placeLinks,adultsPerRoom,roomsFor,beforeYouBook,tripDates,STAY_REFERRALS} from '../lib/handoff.ts';
import {validEventProps} from '../lib/events.ts';

const trip={start:'2027-01-15',end:'2027-01-18',travellers:4};
const params=url=>Object.fromEntries(new URL(url).searchParams);

test('Booking.com: the exact parameters verified in the browser',()=>{
 const [booking]=stayLinks('Ella, Sri Lanka',trip);
 assert.equal(new URL(booking.url).origin+new URL(booking.url).pathname,'https://www.booking.com/searchresults.html');
 assert.deepEqual(params(booking.url),{ss:'Ella, Sri Lanka',checkin:'2027-01-15',checkout:'2027-01-18',group_adults:'4',no_rooms:'2',group_children:'0'});
 assert.equal(booking.label,'Find a place on Booking.com');assert.equal(booking.referral,false);
});
test('Expedia: dates and one adults count per room, comma-separated',()=>{
 const [,expedia]=stayLinks('Ella, Sri Lanka',{...trip,travellers:5});
 assert.equal(new URL(expedia.url).origin+new URL(expedia.url).pathname,'https://www.expedia.com/Hotel-Search');
 assert.deepEqual(params(expedia.url),{destination:'Ella, Sri Lanka',startDate:'2027-01-15',endDate:'2027-01-18',adults:'2,2,1'});
});
test('rooms: two adults per room',()=>{
 assert.deepEqual([1,2,3,4,5,12].map(roomsFor),[1,1,2,2,3,6]);
 assert.deepEqual(adultsPerRoom(1),[1]);assert.deepEqual(adultsPerRoom(7),[2,2,2,1]);assert.deepEqual(adultsPerRoom(12),[2,2,2,2,2,2]);
});
test('without dates the links still carry guests, and never invent dates',()=>{
 const [booking,expedia]=stayLinks('Ella',{start:null,end:null,travellers:2});
 assert.equal(params(booking.url).checkin,undefined);assert.equal(params(expedia.url).startDate,undefined);
 assert.equal(params(booking.url).group_adults,'2');
 assert.equal(params(stayLinks('Ella',{start:'2027-01-18',end:'2027-01-15',travellers:2})[0].url).checkin,undefined,'backwards dates are dropped');
});
test('invalid input gives no links rather than a broken one',()=>{
 for(const t of [{...trip,travellers:0},{...trip,travellers:13},{...trip,travellers:2.5}])assert.deepEqual(stayLinks('Ella',t),[]);
 assert.deepEqual(stayLinks('  ',trip),[]);
});
test('a referral ID is a one-line config change, and turns on the commission note',()=>{
 try{
  STAY_REFERRALS.booking={param:'aid',id:'1234567'};
  const [booking,expedia]=stayLinks('Ella',trip);
  assert.equal(params(booking.url).aid,'1234567');assert.equal(booking.referral,true);assert.equal(expedia.referral,false);
 }finally{STAY_REFERRALS.booking=null;}
 assert.equal(stayLinks('Ella',trip)[0].referral,false);
});
test('the stay area is the most common place named by matched places',()=>{
 assert.equal(stayArea([{place:'Ella'},{place:'Hiriketiya'},{place:'Ella'},{place:'Arrival stop · exact location to confirm'}],'Sri Lanka trip'),'Ella');
 assert.equal(stayArea([],'Sri Lanka trip'),'Sri Lanka trip');
});
test('place links only where a verified route exists',()=>{
 const ivy=placeLinks({title:'Dinner at The Ivy in the Park',place:'Canary Wharf, London',query:'The Ivy in the Park London',kind:'Venue named in video',category:'Food'},trip);
 assert.equal(ivy.length,1);assert.equal(ivy[0].label,'Reserve on OpenTable');assert.equal(ivy[0].url,'https://www.opentable.co.uk/r/the-ivy-in-the-park-london');
 assert.deepEqual(placeLinks({title:'Sunset drinks at Café Soul',place:'Ella',query:'Café Soul Ella',kind:'Café named in video',category:'Food'},trip),[],'no reviewed booking page, no link');
 const tour=placeLinks({title:'Nine Arch Bridge',place:'Ella',query:'Ella Nine Arch Bridge tour',kind:'Place named in video',category:'Experiences'},trip)[0];
 assert.equal(tour.partner,'getyourguide');assert.equal(params(tour.url).partner_id,'EXAMPLE_PARTNER');assert.equal(tour.referral,true);
 assert.deepEqual(placeLinks({title:'Waterfalls by tuk-tuk',place:'Ella',query:'x',kind:'Comparable experience',category:'Experiences'},trip),[]);
 const stay=placeLinks({title:'Roy’s Villa',place:'Sigiriya',query:"Roy's Villa Sigiriya",kind:'Property named in video',category:'Stays'},trip);
 assert.deepEqual(stay.map(l=>[l.partner,l.label,l.linkType]),[['booking','Check availability on Booking.com','stay_property'],['expedia','Check availability on Expedia','stay_property']]);
 assert.equal(params(stay[0].url).ss,"Roy's Villa Sigiriya");
 assert.deepEqual(placeLinks({title:'A base in Ella',place:'Ella',query:'Ella',kind:'Suggested stay search',category:'Stays'},trip),[]);
 assert.deepEqual(placeLinks({title:'Train',place:'Ella',query:'x',kind:'Route named in video',category:'Transport'},trip),[]);
});
test('the before-you-book line names the partner; no prices anywhere',()=>{
 assert.equal(beforeYouBook('Expedia'),'Check the total price and cancellation terms on Expedia before you book.');
 for(const link of stayLinks('Ella',trip))assert.doesNotMatch(link.label+link.url,/£|\$|price=/i);
});
test('outbound_click carries the partner and link type only',()=>{
 assert.deepEqual(validEventProps('outbound_click',{provider:'booking',linkType:'stay_search'}),{provider:'booking',linkType:'stay_search'});
 for(const bad of [{provider:'booking',url:'https://www.booking.com/'},{provider:'booking',placeId:'cafe-soul'},{provider:'booking',venue:'Café Soul'},{provider:'booking',linkType:'Café Soul'}])
  assert.throws(()=>validEventProps('outbound_click',bad),JSON.stringify(bad));
});

test('older places without a query or kind still get safe links, never a crash',()=>{
 // Week-2 shared snapshots stored no query or kind.
 assert.doesNotThrow(()=>placeLinks({title:'Sunset drinks at Café Soul',place:'Ella',category:'Food'},trip));
 assert.deepEqual(placeLinks({title:'Sunset drinks at Café Soul',place:'Ella',category:'Food'},trip),[]);
 const ivy=placeLinks({title:'The Ivy in the Park',place:'London',category:'Food'},trip);assert.equal(ivy[0]?.label,'Reserve on OpenTable');
 assert.equal(params(placeLinks({title:'Nine Arch Bridge',place:'Ella',category:'Experiences'},trip)[0].url).q,'Nine Arch Bridge Ella');
 assert.deepEqual(placeLinks({},trip),[]);
});

test('trip dates read naturally',()=>{
 assert.equal(tripDates('2027-01-15','2027-01-18'),'15 Jan – 18 Jan 2027');
 assert.equal(tripDates('2026-12-30','2027-01-02'),'30 Dec 2026 – 2 Jan 2027');
 assert.equal(tripDates(null,null),'dates not set yet');
});
