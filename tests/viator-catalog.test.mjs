import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viatorCatalogConfig,requestViatorCatalog,resolveViatorDestination,searchViatorCatalog} from '../lib/server/viator-catalog.ts';
import {viatorSearchBody} from '../lib/travel.ts';
const body=viatorSearchBody('Ella train',{start:'2099-01-01',end:'2099-01-05'},'GBP');
test('Viator catalogue sends sandbox and production requests only to their fixed official endpoints',async()=>{
 for(const [environment,expected] of [['sandbox','https://api.sandbox.viator.com'],['production','https://api.viator.com'],[undefined,'https://api.viator.com']]){
  const env={VIATOR_API_KEY:'private-test-key',VIATOR_ENVIRONMENT:environment,VIATOR_API_BASE_URL:'https://untrusted.example'};
  const config=viatorCatalogConfig(env);assert.equal(config.environment,environment??'production');
  let calls=0;
  const response=await requestViatorCatalog(env,body,async(url,options)=>{
   calls++;assert.equal(url,expected+'/partner/search/freetext');assert.ok(!url.includes(env.VIATOR_API_KEY));
   assert.equal(options.method,'POST');assert.equal(options.headers['exp-api-key'],env.VIATOR_API_KEY);
   assert.equal(options.headers.Accept,'application/json;version=2.0');assert.equal(options.redirect,'manual');
   assert.deepEqual(JSON.parse(options.body),body);assert.ok(options.signal instanceof AbortSignal);
   return Response.json({products:{results:[]}});
  });
  assert.equal(response.status,200);assert.equal(calls,1);
 }
});
test('Viator catalogue rejects invalid environments without requests or secret disclosure',async()=>{
 let calls=0;
 for(const environment of ['','Sandbox','staging','production ','https://untrusted.example']){
  const env={VIATOR_API_KEY:'private-test-key',VIATOR_ENVIRONMENT:environment};
  await assert.rejects(requestViatorCatalog(env,body,async()=>{calls++;throw Error('must not request');}),e=>e.status===503&&!e.message.includes(env.VIATOR_API_KEY)&&!e.message.includes(environment||'absent-value'));
 }
 assert.equal(calls,0);
});
test('Viator catalogue without credentials never sends a request',async()=>{
 let calls=0;assert.equal(viatorCatalogConfig({VIATOR_ENVIRONMENT:'sandbox'}),null);
 await assert.rejects(requestViatorCatalog({VIATOR_ENVIRONMENT:'sandbox'},body,async()=>{calls++;throw Error('must not request');}),e=>e.status===503);
 assert.equal(calls,0);
});
test('Viator catalogue redirects are returned for rejection without forwarding credentials',async()=>{
 let calls=0;
 const response=await requestViatorCatalog({VIATOR_API_KEY:'private-test-key',VIATOR_ENVIRONMENT:'sandbox'},body,async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.example'}});
 });
 assert.equal(calls,1);assert.equal(response.status,302);assert.equal(response.ok,false);
});

const ella={id:60470,name:'Ella',parentDestinationId:999,parentDestinationName:'Uva Province'};
const parisFrance={id:479,name:'Paris',parentDestinationName:'Île-de-France'};
const parisTexas={id:1234,name:'Paris',parentDestinationName:'Texas'};
const destinations=(results,totalCount=results.length)=>({destinations:{results,totalCount}});
const search={query:'Ella Nine Arch Bridge tour',place:'Ella',dates:{start:'2099-01-01',end:'2099-01-05'},currency:'GBP'};
const env={VIATOR_API_KEY:'private-test-key',VIATOR_ENVIRONMENT:'production'};

test('A complete unique exact destination is selected, including normalized Unicode and spaces',()=>{
 assert.deepEqual(resolveViatorDestination(destinations([ella]),' ELLA '),{destination:{id:'60470',name:'Ella',parentName:'Uva Province'}});
 assert.equal(resolveViatorDestination(destinations([{id:1,name:'São Paulo'}]),'Sa\u0303o  Paulo').destination.id,'1');
 assert.equal(resolveViatorDestination(destinations([{id:1,name:'São Paulo'}]),'Sao Paulo').status,'destination_required');
});

test('Ambiguous, fuzzy, absent and truncated destination matches never auto-select',()=>{
 const ambiguous=resolveViatorDestination(destinations([parisFrance,parisTexas]),'Paris');
 assert.equal(ambiguous.reason,'ambiguous');assert.equal(ambiguous.candidates.length,2);
 assert.equal(resolveViatorDestination(destinations([ella]),'Hill country').reason,'confirm');
 assert.equal(resolveViatorDestination(destinations([]),'Unknown').reason,'no_match');
 const truncated=resolveViatorDestination(destinations([ella],21),'Ella');
 assert.equal(truncated.status,'destination_required');assert.equal(truncated.hasMore,true);
});

test('Explicit confirmation must exist in the fresh lookup, and a stale ID cannot trigger auto-selection',()=>{
 assert.equal(resolveViatorDestination(destinations([parisFrance,parisTexas]),'Paris','1234').destination.parentName,'Texas');
 assert.equal(resolveViatorDestination(destinations([ella],21),'Ella','60470').destination.id,'60470');
 const stale=resolveViatorDestination(destinations([ella]),'Ella','479');
 assert.equal(stale.reason,'reselect');assert.equal(stale.destination,undefined);
});

test('Malformed or incomplete destination pages fail rather than becoming a global search',()=>{
 for(const payload of [null,{},destinations([ella],0),destinations([ella],1.5),destinations([ella,ella]),destinations(Array(21).fill(ella)),destinations([{...ella,id:'60470'}]),destinations([{...ella,name:''}])])assert.throws(()=>resolveViatorDestination(payload,'Ella'),/could not verify/);
});

test('Zero-count responses may omit results, but missing nonzero or malformed results still fail',async()=>{
 const noDestination=resolveViatorDestination({destinations:{totalCount:0}},'Unknown city');
 assert.equal(noDestination.reason,'no_match');assert.deepEqual(noDestination.candidates,[]);
 for(const data of [{},{totalCount:1},{totalCount:'0'},{totalCount:0,results:null}])assert.throws(()=>resolveViatorDestination({destinations:data},'Ella'),/could not verify/);
 let calls=0;
 const empty=await searchViatorCatalog(env,search,async()=>{},async()=>{
  calls++;return Response.json(calls===1?destinations([ella]):{products:{totalCount:0}});
 });
 assert.equal(calls,2);assert.deepEqual(empty.results,[]);
 for(const products of [{},{totalCount:1},{totalCount:'0'},{totalCount:0,results:null}]){
  calls=0;
  await assert.rejects(searchViatorCatalog(env,search,async()=>{},async()=>{
   calls++;return Response.json(calls===1?destinations([ella]):{products});
  }),/incomplete activity results/);
 }
});

test('Product lookup carries the provider-resolved destination and original query with a quota check for each request',async()=>{
 const bodies=[];let quotaCalls=0;
 const result=await searchViatorCatalog(env,search,async()=>{quotaCalls++;},async(url,options)=>{
  assert.equal(url,'https://api.viator.com/partner/search/freetext');
  const body=JSON.parse(options.body);bodies.push(body);assert.equal(quotaCalls,bodies.length);
  return Response.json(bodies.length===1?destinations([ella]):{products:{results:[]}});
 });
 assert.deepEqual(bodies[0],{searchTerm:'Ella',searchTypes:[{searchType:'DESTINATIONS',pagination:{start:1,count:20}}],currency:'GBP'});
 assert.equal(bodies[1].searchTerm,search.query);assert.equal(bodies[1].productFiltering.destination,'60470');
 assert.deepEqual(bodies[1].productFiltering.dateRange,{from:search.dates.start,to:search.dates.end});
 assert.equal(result.status,'date_filtered_catalog');assert.equal(result.destination.id,'60470');assert.equal(quotaCalls,2);
});

test('Unresolved or stale destinations stop after lookup, with no unfiltered product fallback',async()=>{
 for(const [request,payload] of [[search,destinations([])],[{...search,place:'Paris'},destinations([parisFrance,parisTexas])],[search,destinations([ella],21)],[{...search,destinationId:'479'},destinations([ella])]]){
  let calls=0;
  const result=await searchViatorCatalog(env,request,async()=>{},async(_url,options)=>{
   calls++;assert.equal(JSON.parse(options.body).searchTypes[0].searchType,'DESTINATIONS');return Response.json(payload);
  });
  assert.equal(calls,1);assert.equal(result.status,'destination_required');
 }
});

test('Missing credentials, quota denial and lookup failures cannot spend a product request or reveal secrets',async()=>{
 let calls=0,quotas=0;
 await assert.rejects(searchViatorCatalog({},search,async()=>{quotas++;},async()=>{calls++;return Response.json({});}),/not connected/);
 assert.equal(calls,0);assert.equal(quotas,0);
 await assert.rejects(searchViatorCatalog(env,search,async()=>{quotas++;if(quotas===2)throw Error('quota denied');},async()=>{calls++;return Response.json(destinations([ella]));}),/quota denied/);
 assert.equal(calls,1);
 for(const status of [403,429,500]){
  calls=0;
  await assert.rejects(searchViatorCatalog(env,search,async()=>{},async()=>{calls++;return Response.json({error:'private-test-key upstream response'},{status});}),e=>!e.message.includes('private-test-key')&&e.status===(status===429?429:502));
  assert.equal(calls,1);
 }
});

test('Provider fallback products outside the resolved destination are withheld by taxonomy',async()=>{
 const york={id:5446,name:'York',parentDestinationName:'Yorkshire'};
 const tour={title:'Ella tour',destinations:[{ref:'60470',primary:true}]};
 let calls=0,quotas=0;
 const result=await searchViatorCatalog(env,{...search,place:'York'},async()=>{quotas++;},async(url)=>{
  calls++;
  if(url.endsWith('/destinations'))return Response.json({totalCount:2,destinations:[{destinationId:5446,lookupId:'6.10.5446'},{destinationId:60470,lookupId:'2.4.60470'}]});
  return Response.json(calls===1?destinations([york]):{products:{results:[tour]}});
 });
 assert.equal(calls,3);assert.equal(quotas,3);assert.equal(result.destination.id,'5446');
 assert.deepEqual(result.results,[]);assert.equal(result.withheldCount,1);
});
