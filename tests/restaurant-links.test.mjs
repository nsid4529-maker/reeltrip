import test from 'node:test';
import assert from 'node:assert/strict';
import {restaurantSearchLinks,verifiedRestaurantLinks,restaurantMapSearch,restaurantRegion,restaurantRegions,safeRestaurantWebsite} from '../lib/restaurant-links.ts';

const search=region=>restaurantSearchLinks({query:'Cafe Soul',place:'Ella, Sri Lanka',region});

test('Sri Lanka links search for the named restaurant across relevant providers',()=>{
 const links=search('sri-lanka');
 for(const [provider,domain] of [['Eat App','eatapp.co'],['MyTable','mytable.lk'],['TableAgent','tableagent.com']]){
  const link=links.find(link=>link.provider===provider),url=new URL(link.url);
  assert.equal(url.hostname,'www.google.com');assert.equal(url.searchParams.get('q'),`site:${domain} Cafe Soul Ella, Sri Lanka`);
  assert.equal(link.kind,'search');assert.match(link.label,/Cafe Soul/);assert.match(link.detail,/No exact listing or availability/);
 }
 assert.equal(new URL(links.find(link=>link.id==='maps').url).searchParams.get('query'),'Cafe Soul Ella, Sri Lanka');
 assert.equal(links.some(link=>link.kind==='directory'||link.kind==='venue'),false);
});

test('global and regional provider searches never invent a restaurant slug or availability',()=>{
 assert.deepEqual(search('global').filter(link=>link.id!=='maps').map(link=>link.provider),['Eat App','OpenTable','SevenRooms','TableCheck','TheFork']);
 for(const region of restaurantRegions)for(const link of search(region.id)){
  assert.equal(new URL(link.url).protocol,'https:');assert.equal(link.kind,'search');assert.equal('available' in link,false);
  if(link.id!=='maps')assert.ok(new URL(link.url).searchParams.get('q').startsWith('site:'));
 }
 assert.match(new URL(search('japan').find(link=>link.provider==='TableCheck').url).searchParams.get('q'),/^site:tablecheck.com /);
 assert.match(new URL(search('europe').find(link=>link.provider==='TheFork').url).searchParams.get('q'),/^site:thefork.com /);
});

test('Raa’s, Cactus and Malkoha remain honest named searches without fabricated booking listings',()=>{
 for(const [query,place] of [['Raa’s Hiriketiya','Hiriketiya'],['Cactus Ahangama area','Ahangama area'],['Malkoha Hiriketiya','Hiriketiya']]){
  const links=restaurantSearchLinks({query,place});
  assert.equal(links.some(link=>link.kind==='venue'),false);
  assert.ok(links.every(link=>link.kind==='search'));
  for(const link of links.filter(link=>link.id!=='maps'))assert.ok(new URL(link.url).searchParams.get('q').includes(query));
 }
});

test('Kai opens its verified MyTable and official Ahangama pages rather than a generic directory',()=>{
 const links=restaurantSearchLinks({query:'Kai Ahangama — Rooftop Cafe and Bar Ahangama',place:'Ahangama',kind:'Venue named in video'});
 assert.deepEqual(links.filter(link=>link.kind==='venue').map(link=>link.url),['https://mytable.lk/venues/63','https://discoverkai.com/properties/kai-ahangama/']);
 assert.equal(links.find(link=>link.provider==='Eat App').kind,'search');
 assert.equal(links.some(link=>link.label.startsWith('Browse')),false);
});

test('multiple verified Paradise Cove booking providers stay attached to the Midigama venue',()=>{
 const links=restaurantSearchLinks({query:'Paradise Cove Midigama Sri Lanka',place:'Midigama',direct:'https://paradisecovemidigama.com/',meal:{date:'2027-01-12',time:'19:00',covers:4}});
 assert.deepEqual(links.filter(link=>link.kind==='venue').map(link=>link.provider),['Classcruiser','TableAgent','Venue website']);
 assert.equal(links.filter(link=>link.url==='https://paradisecovemidigama.com/').length,1);
 for(const link of links.filter(link=>link.kind==='venue')){assert.equal(new URL(link.url).search,'');assert.equal(!!link.mealIncluded,false);}
 const smoke=verifiedRestaurantLinks({query:'Smoke & Bitters Hiriketiya',place:'Hiriketiya'});
 assert.equal(smoke[0]?.url,'https://www.smokeandbitters.com/contact');assert.match(smoke[0].detail,/request a table/);
});

test('exact links require a single named venue, matching city and sufficient source confidence',()=>{
 for(const input of [
  {query:'Kai Ahangama',place:'Colombo'},
  {query:'Kai Ahangama or Paradise Cove',place:'Ahangama'},
  {query:'Another Kai Ahangama cafe',place:'Ahangama'},
  {query:'Paradise Cove',place:'Malibu'},
  {query:'Kai Ahangama United Kingdom',place:'Ahangama'},
  {query:'Smoke and Bitters',place:'Unknown'},
  ...['Unknown venue','Suggested alternative','Area search · venue unnamed','Unverified restaurant'].map(kind=>({query:'Kai Ahangama',place:'Ahangama',kind})),
 ])assert.deepEqual(verifiedRestaurantLinks(input),[],JSON.stringify(input));
});

test('known London provider pages preserve their existing validated date and guest contract',()=>{
 const meal={date:'2027-01-12',time:'19:30',covers:4};
 const ivy=verifiedRestaurantLinks({query:'The Ivy in the Park London',place:'London',meal})[0];
 assert.equal(ivy.provider,'OpenTable');assert.equal(new URL(ivy.url).searchParams.get('dateTime'),'2027-01-12T19:30');assert.equal(new URL(ivy.url).searchParams.get('covers'),'4');assert.equal(ivy.mealIncluded,true);
 const oudh=verifiedRestaurantLinks({query:'Oudh 1722 London',place:'London',meal})[0];
 assert.equal(oudh.provider,'SevenRooms');assert.equal(new URL(oudh.url).searchParams.get('date'),'2027-01-12');assert.equal(new URL(oudh.url).searchParams.get('party_size'),'4');assert.equal(new URL(oudh.url).searchParams.get('start_time'),'19:30');
 const invalid=verifiedRestaurantLinks({query:'Oudh 1722',place:'London',meal:{...meal,date:'2027-02-30'}})[0];assert.equal(new URL(invalid.url).search,'');assert.equal(invalid.mealIncluded,false);
});

test('provider region is explicitly selected and invalid region values use the global providers',()=>{
 assert.deepEqual(search(undefined),search('global'));
 assert.equal(restaurantRegion('__proto__'),'global');
 assert.deepEqual(search('https://attacker.example'),search('global'));
});

test('query encoding preserves names and locations without allowing URL parameter injection',()=>{
 const url=new URL(restaurantMapSearch('A&B Cafe #1?api=0','Kyoto, Japan'));
 assert.equal(url.hostname,'www.google.com');assert.equal(url.searchParams.get('api'),'1');
 assert.equal(url.searchParams.get('query'),'A&B Cafe #1?api=0 Kyoto, Japan');assert.deepEqual([...url.searchParams.keys()],['api','query']);
 assert.equal(new URL(restaurantMapSearch('Café Paris','Paris')).searchParams.get('query'),'Café Paris');
 assert.ok(restaurantMapSearch('🍣'.repeat(240),'東京'.repeat(160)).length<=2048);
 assert.equal(new URL(restaurantMapSearch('','')).searchParams.get('query'),'restaurants');
 for(const link of restaurantSearchLinks({query:'🍣'.repeat(240),place:'東京'.repeat(160)}))assert.ok(link.url.length<=2048);
 const provider=new URL(restaurantSearchLinks({query:'A&B?x=1#cafe',place:'Kyoto'}).find(link=>link.provider==='Eat App').url);
 assert.deepEqual([...provider.searchParams.keys()],['q']);assert.match(provider.searchParams.get('q'),/A&B\?x=1#cafe/);
});

test('source website handoffs reject unsafe destinations and never claim verification',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,foo','/local','http://restaurant.example','https://name:secret@restaurant.example','https://localhost','https://127.0.0.1','https://[::1]','https://2130706433','https://venue.local','https://venue.internal','https://restaurant.example:8080','https://restaurant.example\n.evil.example']){
  assert.equal(safeRestaurantWebsite(url),undefined,url);
  assert.equal(restaurantSearchLinks({query:'A cafe',place:'Ella',direct:url}).some(link=>link.id==='venue-website'),false,url);
 }
 const direct='https://restaurant.example/reservations?ref=reeltrip';
 const link=restaurantSearchLinks({query:'A cafe',place:'Ella',direct}).find(link=>link.id==='venue-website');
 assert.equal(link.kind,'website');assert.equal(link.url,direct);assert.match(link.detail,/Confirm the name and location/);
});
