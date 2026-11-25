import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viatorProductURL,viatorCatalogRequest,parseViatorCatalog,parseViatorDestinationRequired,loadViatorCatalog} from '../lib/viator-results.ts';
import {localTimeZone} from '../lib/calendar-day.ts';

const match={id:'source-train',title:'Nanu Oya → Ella',place:'Sri Lanka',category:'Transport',source:'creator-video',second:29,quote:'Take the Nanu Oya to Ella train.',kind:'Route named in video',query:'Nanu Oya to Ella train tickets',providers:['Viator']};
const dates={start:'2099-02-01',end:'2099-02-05'};
const product={title:'Nanu Oya to Ella reserved train seats',productCode:'12345P1',productUrl:'https://www.viator.com/tours/Ella/Train/d123-12345P1?pid=partner',pricing:{currency:'GBP',summary:{fromPrice:42.5}}};
const destination={id:'60470',name:'Ella',parentName:'Uva Province'};
const catalog=(results=[product],environment='production')=>({status:'date_filtered_catalog',environment,destination,withheldCount:0,checkedAt:'2026-11-18T00:00:00.000Z',results});

test('Viator catalogue search retains the chosen reel recommendation, dates and currency',async()=>{
 const request=viatorCatalogRequest(match,dates,'GBP');
 assert.deepEqual(request,{query:match.query,place:match.place,dates,currency:'GBP',timeZone:localTimeZone()});
 assert.notEqual(request.dates,dates);
 const controller=new AbortController();let calls=0;
 const result=await loadViatorCatalog(request,controller.signal,async(url,options)=>{
  calls++;assert.equal(url,'/api/viator');assert.equal(options.method,'POST');
  assert.deepEqual(JSON.parse(options.body),request);assert.equal(options.signal,controller.signal);
  assert.deepEqual(options.headers,{'Content-Type':'application/json'});
  assert.equal(options.cache,'no-store');
  return Response.json(catalog());
 });
 assert.equal(calls,1);assert.equal(result.results[0].title,product.title);
 assert.deepEqual(result.destination,destination);
 assert.deepEqual(result.results[0].price,{amount:42.5,currency:'GBP'});
});

test('Invalid activity selections, dates and currencies cannot form a catalogue request',()=>{
 assert.throws(()=>viatorCatalogRequest({...match,category:'Food'},dates,'GBP'),/activity or transport/);
 assert.throws(()=>viatorCatalogRequest({...match,query:'x'.repeat(201)},dates,'GBP'),/shorter provider search/);
 assert.throws(()=>viatorCatalogRequest({...match,query:'  '},dates,'GBP'),/shorter provider search/);
 assert.throws(()=>viatorCatalogRequest(match,{start:'',end:''},'GBP'),/valid arrival/);
 assert.throws(()=>viatorCatalogRequest(match,{start:'2099-02-05',end:'2099-02-01'},'GBP'),/Departure/);
 assert.throws(()=>viatorCatalogRequest(match,{start:'2099-02-01',end:'2099-03-20'},'GBP'),/30 nights/);
 assert.throws(()=>viatorCatalogRequest(match,dates,'XXX'),/supported currency/);
 assert.throws(()=>viatorCatalogRequest(match,dates,'GBP',''),/city or region/);
 assert.throws(()=>viatorCatalogRequest(match,dates,'GBP','Ella','not-a-destination'),/matching locations/);
 assert.deepEqual(viatorCatalogRequest(match,dates,'GBP',' Ella ','60470'),{query:match.query,place:'Ella',dates,currency:'GBP',timeZone:localTimeZone(),destinationId:'60470'});
});

test('Provider links allow HTTPS Viator hosts only and keep attribution parameters',()=>{
 assert.equal(viatorProductURL(product.productUrl),product.productUrl);
 assert.equal(viatorProductURL('https://viator.com/tours/Ella/Train'),'https://viator.com/tours/Ella/Train');
 for(const value of [undefined,{},'javascript:alert(1)','http://www.viator.com/tours/a','//www.viator.com/tours/a','https://viator.com.evil.example/tours/a','https://evil.example/?next=https://viator.com','https://booking.viator.com/a','https://user:pass@viator.com/a','https://viator.com:8443/a','https://viator.com/a\n',' https://viator.com/a','https://viator.com/'+'a'.repeat(2048)])assert.equal(viatorProductURL(value),null,String(value));
 assert.throws(()=>parseViatorCatalog(catalog([{...product,productUrl:'https://evil.example/a'}]),'GBP'),/incomplete results/);
});

test('Catalogue response distinguishes sandbox and production and permits real empty results',()=>{
 for(const environment of ['sandbox','production']){
  const result=parseViatorCatalog(catalog([],environment),'GBP');
  assert.equal(result.environment,environment);assert.deepEqual(result.results,[]);
 }
 for(const value of [null,{},catalog([],'staging'),{...catalog(),status:'available'},{...catalog(),checkedAt:'bad-date'},{...catalog(),results:Array(21).fill(product)},catalog([null]),catalog([{...product,title:''}]),catalog([{...product,productCode:123}])])assert.throws(()=>parseViatorCatalog(value,'GBP'),/incomplete results/);
});

test('Missing prices stay missing; invalid or mismatched prices are never presented as quotes',()=>{
 for(const pricing of [undefined,{}, {currency:'GBP',summary:{}}]){
  const item=parseViatorCatalog(catalog([{...product,pricing}]),'GBP').results[0];
  assert.equal(item.price,undefined);
 }
 assert.equal(parseViatorCatalog(catalog([{...product,pricing:{currency:'GBP',summary:{fromPrice:0}}}]),'GBP').results[0].price.amount,0);
 for(const pricing of [null,[],{currency:'GBP',summary:[]},{currency:'GBP',summary:{fromPrice:'42'}},{currency:'GBP',summary:{fromPrice:-1}},{currency:'GBP',summary:{fromPrice:Infinity}},{currency:'USD',summary:{fromPrice:42}},{summary:{fromPrice:42}}])assert.throws(()=>parseViatorCatalog(catalog([{...product,pricing}]),'GBP'),/incomplete results/);
});

test('Unconfigured, access-denied, rate-limit and malformed responses never create results',async()=>{
 const request=viatorCatalogRequest(match,dates,'GBP');
 const cases=[
  [503,{status:'setup_required'},/not connected/],
  [502,{providerStatus:403,error:'untrusted detailed upstream content'},/could not return/],
  [502,{providerStatus:429},/busy/],
  [429,{},/busy/],
  [200,{status:'date_filtered_catalog'},/incomplete results/],
 ];
 for(const [status,payload,message] of cases)await assert.rejects(loadViatorCatalog(request,new AbortController().signal,async()=>Response.json(payload,{status})),message);
 await assert.rejects(loadViatorCatalog(request,new AbortController().signal,async()=>new Response('not json',{status:200})),/incomplete results/);
});

test('Cancellation is passed to the request and does not synthesize empty results',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(loadViatorCatalog(viatorCatalogRequest(match,dates,'GBP'),controller.signal,async(_url,options)=>{options.signal.throwIfAborted();return Response.json(catalog());}),{name:'AbortError'});
});

test('Destination confirmation remains distinct from products and validates the current lookup',async()=>{
 const request=viatorCatalogRequest(match,dates,'GBP','Ella');
 const required={status:'destination_required',destinationSearch:'Ella',candidates:[destination],hasMore:true,reason:'confirm'};
 assert.deepEqual(parseViatorDestinationRequired(required),required);
 const result=await loadViatorCatalog(request,new AbortController().signal,async()=>Response.json(required));
 assert.equal(result.status,'destination_required');assert.equal(result.results,undefined);
 for(const invalid of [{...required,destinationSearch:'Chicago'},{...required,candidates:[{...destination,id:'https://evil.example'}]},{...required,candidates:[destination,destination]},{...required,candidates:Array(21).fill(destination)}])await assert.rejects(loadViatorCatalog(request,new AbortController().signal,async()=>Response.json(invalid)),/incomplete results/);
 assert.throws(()=>parseViatorCatalog({...catalog(),destination:undefined},'GBP'),/incomplete results/);
 await assert.rejects(loadViatorCatalog({...request,destinationId:'479'},new AbortController().signal,async()=>Response.json(catalog())),/incomplete results/);
});

test('activity catalogue searches can cover one day without requiring an overnight trip',()=>{
 const single={start:'2099-12-22',end:'2099-12-22'};assert.deepEqual(viatorCatalogRequest(match,single,'GBP').dates,single);
});
