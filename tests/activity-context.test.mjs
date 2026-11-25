import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityExplorerUrl,readActivityContext,activityLocations,activitySearchQuery,activityTermsAfterLocationChange} from '../lib/activity-context.ts';
import {viatorCatalogRequest} from '../lib/viator-results.ts';
import {browseProviderUrl} from '../lib/travel.ts';

test('moving a reel activity to its own tab retains location, query, dates and party',()=>{
 const match={title:'Waterfalls by tuk-tuk',query:'Ella waterfalls & tea',place:'Ella'};
 const url=new URL(activityExplorerUrl(match,{start:'2099-01-02',end:'2099-01-05'},4,'EUR'),'https://reeltrip.example');
 assert.equal(url.pathname,'/activities');
 assert.deepEqual(readActivityContext(url.searchParams),{destination:'Ella',query:'Ella waterfalls & tea',title:match.title,start:'2099-01-02',end:'2099-01-05',adults:4,currency:'EUR'});
});
test('unselected, impossible or reversed dates cannot masquerade as selected dates',()=>{
 for(const dates of [undefined,{start:'2099-02-30',end:'2099-03-02'},{start:'2099-01-06',end:'2099-01-02'}]){
  const u=new URL(activityExplorerUrl({title:'Cruise',query:'Canal',place:'Amsterdam'},dates),'https://reeltrip.example');
  assert.equal(u.searchParams.has('start'),false);assert.equal(u.searchParams.has('end'),false);
 }
});
test('activity links bound untrusted preferences and preserve a single-day search',()=>{
 const c=readActivityContext(new URLSearchParams({destination:'x'.repeat(1000),q:'\u0000Tea & cafés',adults:'999',currency:'bad',start:'2099-01-02',end:'2099-01-02'}));
 assert.equal(c.destination.length,200);assert.equal(c.query,'Tea & cafés');assert.equal(c.adults,2);assert.equal(c.currency,'GBP');assert.equal(c.start,c.end);
});

test('location options retain source names and remove unknown and duplicate places',()=>{
 const matches=[{id:1,place:'Ella'},{id:2,place:' ella '},{id:3,place:'Ahangama'},{id:4,place:'Unknown'},{id:5,place:'Ellaville'}];
 assert.deepEqual(activityLocations(matches,'Sri Lanka'),['Sri Lanka','Ella','Ahangama','Ellaville']);
 assert.deepEqual(activityLocations(['Arrival stop · exact location to confirm','Location unknown','Exact location not established','Unknown Hill','Confirmation Beach','Arrival Bay'].map(place=>({place}))),['Unknown Hill','Confirmation Beach','Arrival Bay']);
});

test('changing location clears stale named search terms, without altering source evidence or generic interests',()=>{
 const source={category:'Experiences',source:'original-reel',title:'Train from Ella to Kandy',query:'Ella to Kandy train',place:'Ella'};
 const original=structuredClone(source);
 assert.equal(activityTermsAfterLocationChange(source.query,'Ella','Ella',true),source.query);
 assert.equal(activityTermsAfterLocationChange(source.query,'Ella','Ahangama',true),'');
 assert.equal(activityTermsAfterLocationChange('Ella waterfalls','Ella','Ahangama'),'');
 assert.equal(activityTermsAfterLocationChange('Food tour','Ella','Ahangama'),'Food tour');
 assert.equal(activityTermsAfterLocationChange('Umbrella painting','Ella','Ahangama'),'Umbrella painting');
 const query=activitySearchQuery(activityTermsAfterLocationChange(source.query,source.place,'Ahangama',true),'Ahangama');
 const searchMatch={...source,source:'explore',place:'Ahangama',query};
 const api=viatorCatalogRequest(searchMatch,{start:'2099-01-02',end:'2099-01-05'},'GBP');
 const publicURL=new URL(browseProviderUrl(searchMatch,'Viator'));
 assert.equal(api.place,'Ahangama');assert.equal(api.query,'Ahangama');assert.equal(publicURL.searchParams.get('text'),api.query);
 assert.deepEqual(source,original);
});

test('activity provider search carries the chosen location with the activity and does not match part of a word',()=>{
 assert.equal(activitySearchQuery('Waterfalls','Ella'),'Ella Waterfalls');
 assert.equal(activitySearchQuery('Ella waterfalls','Ella'),'Ella waterfalls');
 assert.equal(activitySearchQuery('Umbrella painting','Ella'),'Ella Umbrella painting');
 assert.equal(activitySearchQuery('','Ahangama'),'Ahangama');
 assert.equal(activitySearchQuery('Cafés in São Paulo','São Paulo'),'Cafés in São Paulo');
 assert.equal(activitySearchQuery('x'.repeat(300),'Ella').length,200);
});
