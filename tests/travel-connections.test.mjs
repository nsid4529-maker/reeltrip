import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hotelSearchLinks,skyscannerSearchUrl,flightSearchError} from '../lib/travel-connections.ts';
import {browseProviderUrl,providerUrl} from '../lib/travel.ts';

const dates={start:'2099-01-02',end:'2099-01-05'};
const flight={origin:'LHR',destination:'AMS',dates,adults:3,currency:'GBP'};

test('hotel providers preserve the actual query, chosen dates and room occupancy',()=>{
 const query="Roy’s Villa, Sigiriya & spa / Sri Lanka";
 const links=hotelSearchLinks(query,dates,4,'EUR');
 assert.deepEqual(links.map(link=>link.provider),['Booking.com','Expedia','Airbnb']);
 const booking=new URL(links[0].url),expedia=new URL(links[1].url);
 assert.equal(booking.origin,'https://www.booking.com');assert.equal(booking.pathname,'/searchresults.html');
 assert.equal(booking.searchParams.get('ss'),query);assert.equal(booking.searchParams.get('checkin'),dates.start);assert.equal(booking.searchParams.get('checkout'),dates.end);
 assert.equal(booking.searchParams.get('group_adults'),'4');assert.equal(booking.searchParams.get('no_rooms'),'1');assert.equal(booking.searchParams.get('group_children'),'0');assert.equal(booking.searchParams.get('selected_currency'),'EUR');
 assert.equal(expedia.origin,'https://www.expedia.com');assert.equal(expedia.pathname,'/Hotel-Search');
 assert.equal(expedia.searchParams.get('destination'),query);assert.equal(expedia.searchParams.get('startDate'),dates.start);assert.equal(expedia.searchParams.get('endDate'),dates.end);assert.equal(expedia.searchParams.get('adults'),'4');
 assert.equal(expedia.searchParams.has('currency'),false);assert.equal(links[1].currencyIncluded,false);assert.equal(links[0].currencyIncluded,true);
 assert.ok(links.every(link=>link.datesIncluded));
});

test('browse-only hotel searches do not invent dates or check-in times',()=>{
 const links=hotelSearchLinks('Kyoto, Japan');assert.equal(links.length,3);
 for(const link of links){const url=new URL(link.url);assert.equal(link.datesIncluded,false);for(const key of ['checkin','checkout','startDate','endDate','checkin_time','checkout_time'])assert.equal(url.searchParams.has(key),false);}
});

test('invalid hotel dates and party sizes never become dated links or silent browse fallbacks',()=>{
 for(const badDates of [null,{}, {start:'',end:''},{start:dates.start,end:''},{start:'2099-02-30',end:'2099-03-05'},{start:dates.end,end:dates.start},{start:dates.start,end:dates.start},{start:'2020-01-01',end:'2020-01-02'},{start:dates.start,end:'2099-03-02'}])assert.deepEqual(hotelSearchLinks('Amsterdam',badDates),[]);
 for(const adults of [0,-1,1.5,9,NaN])assert.deepEqual(hotelSearchLinks('Amsterdam',dates,adults),[]);
 for(const query of ['', '   ', 'x'.repeat(241),null])assert.deepEqual(hotelSearchLinks(query,dates),[]);
 assert.deepEqual(hotelSearchLinks('Amsterdam',dates,2,'INVALID'),[]);
});

test('hotel cards use the same provider contracts and unknown providers do not route to GetYourGuide',()=>{
 const match={query:'Ella Sri Lanka'};
 for(const provider of ['Booking.com','Expedia','Airbnb']){
  assert.equal(providerUrl(match,provider,dates,3,'GBP'),hotelSearchLinks(match.query,dates,3,'GBP').find(link=>link.provider===provider).url);
  assert.equal(browseProviderUrl(match,provider),hotelSearchLinks(match.query).find(link=>link.provider===provider).url);
  assert.equal(providerUrl(match,provider,{start:'',end:''},3,'GBP'),'');
 }
 assert.equal(providerUrl(match,'Unrecognised',dates,3,'GBP'),'');assert.equal(browseProviderUrl(match,'Unrecognised'),'');
});

test('Skyscanner uses the selected return dates, airports, adults and currency',()=>{
 const url=new URL(skyscannerSearchUrl({...flight,origin:' lhr ',destination:'ams'}));
 assert.equal(url.origin,'https://www.skyscanner.net');assert.equal(url.pathname,'/transport/flights/lhr/ams/990102/990105/');
 assert.equal(url.searchParams.get('adultsv2'),'3');assert.equal(url.searchParams.get('currency'),'GBP');assert.equal(url.searchParams.get('cabinclass'),'economy');assert.equal(url.searchParams.has('departure-times'),false);
});

test('Skyscanner local departure-time ranges encode independently for each leg',()=>{
 const times={outboundTime:{from:'06:00',to:'12:00'},returnTime:{from:'12:00',to:'18:00'}};
 assert.equal(new URL(skyscannerSearchUrl({...flight,...times})).searchParams.get('departure-times'),'360-720,720-1080');
 assert.equal(new URL(skyscannerSearchUrl({...flight,returnTime:{from:'18:00',to:'23:59'}})).searchParams.get('departure-times'),'0-1439,1080-1439');
});

test('Skyscanner search preserves explicit cabin, stops and exact airports in the same handoff as time filters',()=>{
 const url=new URL(skyscannerSearchUrl({...flight,cabin:'business',directOnly:true,outboundTime:{from:'06:00',to:'12:00'}}));
 assert.equal(url.searchParams.get('cabinclass'),'business');
 assert.equal(url.searchParams.get('preferdirects'),'true');
 assert.equal(url.searchParams.get('outboundaltsenabled'),'false');
 assert.equal(url.searchParams.get('inboundaltsenabled'),'false');
 assert.equal(url.searchParams.get('rtn'),'1');
 assert.equal(url.searchParams.get('adultsv2'),'3');
 assert.equal(url.searchParams.get('departure-times'),'360-720,0-1439');
 for(const cabin of ['economy','premiumeconomy','business','first'])assert.equal(new URL(skyscannerSearchUrl({...flight,cabin})).searchParams.get('cabinclass'),cabin);
 for(const changed of [{cabin:'invalid'},{cabin:'economy&adultsv2=99'},{directOnly:'true'}])assert.equal(skyscannerSearchUrl({...flight,...changed}),'');
});

test('invalid flight inputs do not produce a provider URL',()=>{
 for(const changed of [{origin:''},{origin:'LH'},{origin:'https://evil.test'},{origin:'AMS'},{destination:''},{destination:'AMS/evil'},{dates:{start:'',end:''}},{dates:{start:'2020-01-01',end:'2020-01-05'}},{adults:0},{adults:1.2},{adults:9},{currency:'XXX'},{outboundTime:{from:'24:00',to:'25:00'}},{outboundTime:{from:'18:00',to:'06:00'}},{returnTime:{from:'06:00',to:'06:00'}},{returnTime:{from:'00:00',to:'https://evil.test'}}]){
  const input={...flight,...changed};assert.equal(skyscannerSearchUrl(input),'');assert.ok(flightSearchError(input));
 }
});
