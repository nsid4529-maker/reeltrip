import test from 'node:test';
import assert from 'node:assert/strict';
import {accommodationMatches,browseProviderUrl,hotelProviderLinks,hotelSearchLinks,hotelSearchQuery,providerUrl,searchLocationText} from '../lib/travel.ts';
import {providerProduct} from '../lib/provider-links-save.ts';
import {itemForProviderLink,interestKey} from '../lib/interested.ts';
import {savedChoiceHandoff} from '../lib/saved-choice-links.ts';
import {prepareSpecialists} from '../lib/booking-specialists.ts';
import {tripAccommodationRows} from '../lib/trip-planning.ts';

const dates={start:'2099-01-02',end:'2099-01-05'};
const stay=(id,title,place,extra={})=>({id,title,place,source:'route',category:'Stays',kind:'AI-identified · confirm the name',query:place,quote:'A stay named in the video',second:10,providers:['Booking.com'],...extra});
const first=stay('first','First villa','Sigiriya'),second=stay('second','Kottawatta Village','Udawalawe');
const preferences={name:'Sri Lanka',destination:'Sri Lanka',dates:[dates],activeDate:0,adults:3,currency:'EUR',brief:''};

test('every stay remains available across the selected reels, including later properties in other regions',()=>{
 const other=stay('other','Other trip hotel','Colombo',{source:'other'}),activity={...second,id:'activity',category:'Experiences'};
 assert.deepEqual(accommodationMatches([first,second,other,activity,second],['route']).map(m=>m.id),['first','second']);
 assert.deepEqual(accommodationMatches([first,second],[]),[]);
 assert.deepEqual(accommodationMatches([first,{...second,id:first.id,source:'another'}],['route','another']).map(m=>m.title),['First villa','Kottawatta Village']);
});
test('named stays keep their name in hotel searches when the extraction query only contains the region',()=>{
 assert.equal(hotelSearchQuery(second),'Kottawatta Village Udawalawe');
 const booking=new URL(providerUrl(first,'Booking.com',dates,3,'EUR'));
 assert.equal(booking.searchParams.get('ss'),'First villa Sigiriya');
 assert.equal(booking.searchParams.get('checkin'),dates.start);assert.equal(booking.searchParams.get('group_adults'),'3');
 const unknown=stay('unknown','A poolside stay','Ahangama',{kind:'Suggested stay search',query:'Ahangama Sri Lanka'});
 assert.equal(hotelSearchQuery(unknown),'Ahangama Sri Lanka');
 assert.equal(hotelSearchQuery({...second,query:'Kottawatta Village Udawalawe Sri Lanka'}),'Kottawatta Village Udawalawe Sri Lanka');
 assert.equal(hotelSearchQuery({...second,query:'q'.repeat(400)}),'Kottawatta Village Udawalawe');
 assert.ok(hotelSearchLinks(hotelSearchQuery({...second,title:'T'.repeat(200),place:'P'.repeat(200)}),dates).length);
});
test('provider queries omit uncertainty metadata while retaining literal property and place names',()=>{
 const title='The Villa by Contemporary Ceylon';
 for(const place of ['Arrival stop · exact location to confirm','Location unknown','Exact location not established','Unknown','To be confirmed']){
  const match=stay('villa',title,place,{query:title+' '+place});
  assert.equal(searchLocationText(place),'');assert.equal(hotelSearchQuery(match),title);
  assert.equal(hotelSearchQuery({...match,query:'Villa hotel search'}),title);
  assert.equal(new URL(providerUrl(match,'Booking.com',dates,3,'GBP')).searchParams.get('ss'),title);
 }
 for(const place of ['Unknown Hill','Confirmation Beach','Arrival Bay','Saint-Unknown-sur-Mer','Ahangama'])assert.equal(searchLocationText(place),place);
 assert.equal(hotelSearchQuery(stay('villa','Unknown Hotel','Confirmation Beach',{query:'Unknown Hotel Confirmation Beach'})),'Unknown Hotel Confirmation Beach');
});
test('Airbnb searches include the actual destination, dates and adults without claiming currency or live availability',()=>{
 const query='Ahangama, Sri Lanka',link=hotelSearchLinks(query,dates,3,'EUR').find(link=>link.provider==='Airbnb'),url=new URL(link.url);
 assert.equal(url.origin,'https://www.airbnb.com');assert.equal(decodeURIComponent(url.pathname),'/s/'+query+'/homes');
 assert.equal(url.searchParams.get('checkin'),dates.start);assert.equal(url.searchParams.get('checkout'),dates.end);assert.equal(url.searchParams.get('adults'),'3');
 assert.equal(link.datesIncluded,true);assert.equal(link.currencyIncluded,false);assert.equal(url.searchParams.has('currency'),false);assert.equal(link.availability,undefined);
 const browse=new URL(hotelSearchLinks(query).find(link=>link.provider==='Airbnb').url);assert.equal(browse.searchParams.has('checkin'),false);assert.equal(browse.searchParams.has('checkout'),false);
});
test('only specific Airbnb room pages become stable saved stay identities',()=>{
 const first=itemForProviderLink('https://www.airbnb.co.uk/rooms/1234567890123456789?checkin=2099-01-01&source_impression_id=private#details','My cabin'),second=itemForProviderLink('https://airbnb.com/rooms/1234567890123456789/');
 assert.equal(first.kind,'hotel');assert.equal(first.provider,'Airbnb');assert.equal(first.url,'https://www.airbnb.com/rooms/1234567890123456789');assert.equal(interestKey(first),interestKey(second));
 assert.equal(second.title,'Airbnb stay 1234567890123456789');assert.equal(second.titleSource,'link');assert.equal(second.place,'');
 for(const url of ['https://www.airbnb.com/s/London/homes','https://www.airbnb.com/rooms/0','https://www.airbnb.com/rooms/123/redirect','https://www.airbnb.com/rooms/123%2F456','https://airbnb.com.evil.test/rooms/123','https://www.airbnb.com/users/123','https://www.airbnb.com/experiences/123','https://abnb.me/example'])assert.equal(providerProduct(url),null,url);
});
test('Airbnb saved handoffs preserve exact listing identity while using current bucket dates and guests',()=>{
 const item=itemForProviderLink('https://www.airbnb.com/rooms/123456'),before=structuredClone(item),result=savedChoiceHandoff(item,preferences),url=new URL(result.currentUrl);
 assert.equal(url.pathname,'/rooms/123456');assert.equal(url.searchParams.get('check_in'),dates.start);assert.equal(url.searchParams.get('check_out'),dates.end);assert.equal(url.searchParams.has('checkin'),false);assert.equal(url.searchParams.has('checkout'),false);assert.equal(url.searchParams.get('adults'),'3');assert.equal(providerProduct(result.currentUrl).identity,providerProduct(item.url).identity);assert.deepEqual(item,before);
});
test('hotel preparation retains each named stay and adds Airbnb for each property search',()=>{
 const cards=prepareSpecialists({analyses:[{source:{id:'route'},matches:[first,second]}],interests:[],preferences});
 assert.equal(cards.length,2);
 for(const card of cards)assert.ok(card.links.some(link=>link.provider==='Airbnb'));
 const generic=cards[0].links.find(link=>link.provider==='Booking.com'),exact=cards[1].links.find(link=>link.provider==='Booking.com');
 assert.equal(new URL(generic.url).searchParams.get('ss'),'First villa Sigiriya');assert.equal(generic.kind,'search');
 assert.equal(new URL(exact.url).pathname,'/hotel/lk/kottawatta-village.html');assert.equal(exact.kind,'venue');assert.match(exact.label,/Open Kottawatta Village/);assert.match(exact.notice,/Confirm room availability/);
});
test('the confirmed Kottawatta property resolves narrowly by name and location, without changing source evidence',()=>{
 for(const title of ['Kottawatta Village','Kotawa Village','Kottawatta Village, Udawalawe'])for(const place of ['Udawalawe','Udawalawa','Uda Walawe, Sri Lanka']){
  const match={...second,title,place},before=structuredClone(match),links=hotelProviderLinks(match,dates,3,'EUR'),booking=links.find(link=>link.provider==='Booking.com'),url=new URL(booking.url);
  assert.equal(url.origin,'https://www.booking.com');assert.equal(url.pathname,'/hotel/lk/kottawatta-village.html');assert.equal(url.searchParams.has('ss'),false);
  assert.equal(url.searchParams.get('checkin'),dates.start);assert.equal(url.searchParams.get('checkout'),dates.end);assert.equal(url.searchParams.get('group_adults'),'3');assert.equal(url.searchParams.get('no_rooms'),'1');assert.equal(url.searchParams.get('group_children'),'0');assert.equal(url.searchParams.get('selected_currency'),'EUR');
  assert.equal(booking.propertyName,'Kottawatta Village');assert.equal(booking.availability,undefined);assert.equal(providerProduct(booking.url).identity,'hotel:booking:lk:kottawatta-village');
  assert.deepEqual(links.filter(link=>link.provider!=='Booking.com'),hotelSearchLinks(hotelSearchQuery(match),dates,3,'EUR').filter(link=>link.provider!=='Booking.com'));
  assert.equal(providerUrl(match,'Booking.com',dates,3,'EUR'),booking.url);assert.deepEqual(match,before);
 }
 const browse=new URL(browseProviderUrl(second,'Booking.com'));assert.equal(browse.pathname,'/hotel/lk/kottawatta-village.html');assert.equal(browse.searchParams.has('checkin'),false);assert.equal(browse.searchParams.has('checkout'),false);
 for(const [dateRange,adults,currency] of [[{start:dates.end,end:dates.start},3,'GBP'],[dates,0,'GBP'],[dates,3,'INVALID']])assert.deepEqual(hotelProviderLinks(second,dateRange,adults,currency),[]);
});
test('property matching never replaces broad, ambiguous, wrong-city or different-name hotel searches',()=>{
 const rejected=[
  {...second,place:'Colombo'},{...second,place:'Udawalawe Australia'},{...second,place:'Sri Lanka'},{...second,place:'Unknown'},
  {...second,title:'Kottawatta Village Resort'},{...second,title:'Kottawatta River Bank Resort'},{...second,title:'A stay in Udawalawe'},
  {...second,kind:'Suggested stay search'},{...second,kind:'Hotel unnamed'},{...second,kind:'Comparable alternative'},{...second,category:'Experiences'},
  {...second,title:'A stay',query:'Kottawatta Village Udawalawe'},
 ];
 for(const match of rejected){const links=hotelProviderLinks(match,dates);assert.deepEqual(links,hotelSearchLinks(hotelSearchQuery(match),dates));assert.ok(links.every(link=>!link.propertyName));assert.equal(new URL(links[0].url).pathname,'/searchresults.html');}
 // Destination-only searches never turn into a verified source recommendation.
 assert.equal(new URL(hotelSearchLinks('Kottawatta Village Udawalawe',dates)[0].url).pathname,'/searchresults.html');
});
test('the travel page takes all stays only from this bucket’s attached reels and preserves source identity',()=>{
 const reel={id:'tiktok-1234567890123456789',url:'https://www.tiktok.com/@test/video/1234567890123456789',platform:'TikTok'},other={...reel,id:'tiktok-2234567890123456789',url:'https://www.tiktok.com/@test/video/2234567890123456789'};
 const cache={[reel.id]:{status:'complete',clip:{source:{id:'route',title:'My trip'},matches:[first,second,stay('foreign','Foreign source','Elsewhere',{source:'another'})]}},[other.id]:{status:'complete',clip:{source:{id:'other'},matches:[stay('other','Other bucket hotel','Elsewhere',{source:'other'})]}}};
 const rows=tripAccommodationRows([reel,reel],cache);assert.deepEqual(rows.map(row=>row.match.title),['First villa','Kottawatta Village']);assert.ok(rows.every(row=>row.source.id==='route'));
 assert.deepEqual(tripAccommodationRows([],cache),[]);assert.deepEqual(tripAccommodationRows([other],cache).map(row=>row.match.title),['Other bucket hotel']);
});
