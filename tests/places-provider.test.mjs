import test from 'node:test';
import assert from 'node:assert/strict';
import {googleProvider,placesProvider,ProviderError,SEARCH_FIELDS,DETAILS_FIELDS} from '../lib/server/places/provider.ts';
import {fixtureProvider} from '../lib/server/places/fixture.ts';

test('Google adapter: tight field masks, key in a header only, nothing billed above what the card needs',async()=>{
 const key='AIzaTEST_key_0123456789abcdef',calls=[];
 const g=googleProvider(key,async(url,init)=>{calls.push({url,init});return url.includes('searchText')?Response.json({places:[{id:'ChIJ_test_place_1',displayName:{text:'Café Soul'},formattedAddress:'Ella',location:{latitude:6.8,longitude:81.0}},{id:'bad id!'}]}):Response.json({id:'ChIJ_test_place_1',displayName:{text:'Café Soul'},formattedAddress:'Ella',location:{latitude:6.8,longitude:81.0},googleMapsUri:'https://maps.google.com/?cid=1'});});
 const found=await g.search('Café Soul Ella');
 assert.deepEqual(found.map(p=>p.id),['ChIJ_test_place_1'],'malformed ids are dropped');
 const details=await g.details('ChIJ_test_place_1');
 assert.equal(details.mapsUri,'https://maps.google.com/?cid=1');
 assert.equal(calls[0].init.headers['X-Goog-FieldMask'],SEARCH_FIELDS);assert.equal(calls[1].init.headers['X-Goog-FieldMask'],DETAILS_FIELDS);
 for(const fields of [SEARCH_FIELDS,DETAILS_FIELDS])assert.doesNotMatch(fields,/Hours|rating|photos|reviews|priceLevel|\*/i);
 for(const call of calls){assert.ok(!call.url.includes(key),'the key is never in a URL');assert.equal(call.init.headers['X-Goog-Api-Key'],key);}
});
test('Google adapter: errors become a generic provider error that never echoes the key',async()=>{
 const key='AIzaTEST_key_0123456789abcdef';
 for(const [status,reason] of [[429,'busy'],[500,'unavailable'],[403,'unavailable']]){
  const g=googleProvider(key,async()=>new Response('{"error":"'+key+'"}',{status}));
  await assert.rejects(g.search('x'),e=>e instanceof ProviderError&&e.reason===reason&&!e.message.includes(key));
 }
 await assert.rejects(googleProvider(key,async()=>{throw new Error('network '+key);}).search('x'),e=>e instanceof ProviderError&&!e.message.includes(key));
 assert.equal(await googleProvider(key,async()=>new Response('',{status:404})).details('ChIJ_missing_place'),null);
});
test('provider choice: Google with a key, the sample provider only when asked, otherwise none',()=>{
 assert.equal(placesProvider({GOOGLE_PLACES_API_KEY:'AIzaTEST_key_0123456789abcdef'}).name,'google');
 assert.equal(placesProvider({PLACES_PROVIDER:'fixture'}).name,'fixture');
 assert.equal(placesProvider({}),null,'no key never shows sample venues');
 assert.equal(placesProvider({GOOGLE_PLACES_API_KEY:'short'}),null);
});
test('sample provider is deterministic and labels its data as sample',async()=>{
 const p=fixtureProvider(),a=await p.search('Paradise Cove Midigama'),b=await p.search('Paradise Cove Midigama');
 assert.deepEqual(a,b);assert.ok(a.every(x=>x.address.endsWith('(sample data)')));
 assert.equal((await p.details(a[0].id)).id,a[0].id);assert.equal(await p.details('fixture_missing_place'),null);
});
