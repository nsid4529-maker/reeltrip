import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateAvailability,openTableSlots,viatorSlots,resySlots} from '../lib/availability.ts';
import {checkAvailability,checkOpenTable,checkViator,checkResy} from '../lib/server/availability.ts';
import {matches} from '../lib/travel.ts';
const input={matchIds:['cafe-soul'],dates:{start:'2099-02-27',end:'2099-03-02'},day:'2099-02-27',adults:2,currency:'GBP',dining:{date:'2099-02-27',time:'19:00',covers:3}};
const food=matches.find(m=>m.id==='cafe-soul'),activity=matches.find(m=>m.providers.includes('Viator'));
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
test('availability validates calendar dates, meals and bounded party size',()=>{
 validateAvailability(input);
 for(const patch of [{day:'2099-02-30'},{adults:9},{currency:'XYZ'},{dining:null},{matchIds:[]}])assert.throws(()=>validateAvailability({...input,...patch}));
});
test('unconfigured services never make network calls or invent inventory',async()=>{
 const results=await checkAvailability([food,activity],input,{},async()=>{throw Error('must not call');});
 assert.ok(results.every(r=>r.status==='setup_required'&&r.slots.length===0&&!r.checkedAt));
});
test('a key without exact product mapping cannot check a different activity',async()=>{
 const result=await checkViator(activity,input,{}, {VIATOR_API_KEY:'test',VIATOR_ACCESS_LEVEL:'full'},async()=>{throw Error('must not call');});assert.equal(result.status,'mapping_required');
});
test('Basic, unknown and missing Viator access levels never call party availability',async()=>{
 let calls=0;
 for(const level of ['basic','unknown',undefined]){
  const result=await checkViator(activity,input,{viatorProductCode:'TEST'},{VIATOR_API_KEY:'SECRET',VIATOR_ACCESS_LEVEL:level},async()=>{calls++;throw Error('must not call');});
  assert.equal(result.status,'access_denied');assert.deepEqual(result.slots,[]);assert.match(result.message,/Activity discovery/);assert.ok(!JSON.stringify(result).includes('SECRET'));
 }
 assert.equal(calls,0);
});
test('Viator uses the documented party-capacity endpoint and labels sandbox results',async()=>{
 let request;
 const result=await checkViator(activity,input,{viatorProductCode:'TEST123'},{VIATOR_API_KEY:'test',VIATOR_ENVIRONMENT:'sandbox',VIATOR_ACCESS_LEVEL:'full'},async(url,init)=>{request={url,init};return json({productCode:'TEST123',travelDate:input.day,bookableItems:[{available:true,startTime:'09:00',productOptionCode:'TG1'},{available:false,startTime:'11:00'}]});});
 assert.match(request.url,/api.sandbox.viator.com\/partner\/availability\/check$/);
 assert.deepEqual(JSON.parse(request.init.body),{productCode:'TEST123',travelDate:input.day,currency:'GBP',paxMix:[{ageBand:'ADULT',numberOfTravelers:2}]});
 assert.equal(result.environment,'sandbox');assert.equal(result.slots.length,1);assert.equal(result.status,'available');
});
test('OpenTable authenticates server-side and sends restaurant-local date and diners',async()=>{
 const calls=[];
 const result=await checkOpenTable(food,input,{opentableId:123},{OPENTABLE_CLIENT_ID:'test',OPENTABLE_CLIENT_SECRET:'secret',OPENTABLE_API_BASE_URL:'https://platform.opentable.com'},async(url,init)=>{calls.push({url,init});return calls.length===1?json({access_token:'token'}):json({rid:123,party_size:3,times_available:[{time:'2099-02-27T19:00:00'}]});});
 assert.match(calls[0].url,/oauth.opentable.com\/api\/v2\/oauth\/token/);
 const url=new URL(calls[1].url);assert.equal(url.pathname,'/v2/availability/123');assert.equal(url.searchParams.get('party_size'),'3');assert.equal(url.searchParams.get('start_date_time'),'2099-02-27T19:00');
 assert.equal(result.status,'available');assert.equal(result.slots[0].label,'19:00');assert.ok(!JSON.stringify(result).includes('secret'));
});
test('wrong identities, dates and malformed inventory become errors, not sold-out results',()=>{
 assert.throws(()=>openTableSlots({rid:999,party_size:3,times:[]},123,3,input.day));
 assert.throws(()=>openTableSlots({rid:123,party_size:3,times:['2099-03-01T19:00']},123,3,input.day));
 assert.throws(()=>openTableSlots({rid:123,party_size:3,times:['garbage']},123,3,input.day));
 assert.throws(()=>viatorSlots({productCode:'OTHER',travelDate:input.day,bookableItems:[]},'TEST',input.day));
 assert.throws(()=>viatorSlots({productCode:'TEST',travelDate:input.day,bookableItems:[{}]},'TEST',input.day));
 assert.deepEqual(openTableSlots({rid:123,party_size:3,times:[]},123,3,input.day),[]);
});
test('provider failures are isolated and secrets/raw responses never reach guests',async()=>{
 const result=await checkViator(activity,input,{viatorProductCode:'TEST'},{VIATOR_API_KEY:'SECRET',VIATOR_ACCESS_LEVEL:'full'},async()=>new Response('SECRET: internal diagnostic',{status:403}));
 assert.equal(result.status,'access_denied');assert.ok(!JSON.stringify(result).includes('SECRET'));assert.deepEqual(result.slots,[]);
 const malformed=await checkViator(activity,input,{viatorProductCode:'TEST'},{VIATOR_API_KEY:'SECRET',VIATOR_ACCESS_LEVEL:'full'},async()=>json({}));assert.equal(malformed.status,'provider_error');
});
test('Resy actor requires explicit enablement and a bounded charge before any paid run',async()=>{
 const mapping={resyUrl:'https://resy.com/cities/new-york-ny/carbone'};
 let called=false;const blocked=await checkResy(food,input,mapping,{APIFY_API_TOKEN:'test'},async()=>{called=true;return json([]);});assert.equal(called,false);assert.equal(blocked.status,'setup_required');
 const result=await checkResy(food,input,mapping,{APIFY_API_TOKEN:'test',APIFY_RESY_ENABLED:'true',APIFY_RESY_MAX_CHARGE_USD:'0.05'},async(url,init)=>{called=true;assert.equal(new URL(url).searchParams.get('maxTotalChargeUsd'),'0.05');const body=JSON.parse(init.body);assert.equal(body.date,input.day);assert.equal(body.partySize,3);assert.deepEqual(body.startUrls,[mapping.resyUrl]);return json([{url:mapping.resyUrl,slots:[{startTime:input.day+' 19:30:00'}]}]);});
 assert.equal(result.status,'available');assert.equal(result.thirdParty,true);
 assert.throws(()=>resySlots([{url:'https://resy.com/cities/other/venue',slots:[]}],mapping.resyUrl,input.day));
});
test('Resy availability-filtered empty datasets remain empty results, while malformed and mismatched venues fail',async()=>{
 const mapping={resyUrl:'https://resy.com/cities/new-york-ny/carbone'};
 const env={APIFY_API_TOKEN:'test',APIFY_RESY_ENABLED:'true',APIFY_RESY_MAX_CHARGE_USD:'0.05'};
 const empty=await checkResy(food,input,mapping,env,async()=>json([]));
 assert.equal(empty.status,'unavailable');assert.deepEqual(empty.slots,[]);assert.ok(empty.checkedAt);assert.match(empty.message,/does not verify the venue/);
 for(const response of [{},[{url:mapping.resyUrl}],[{url:'https://resy.com/cities/new-york-ny/other',slots:[]}],[{url:mapping.resyUrl,slots:[{startTime:'2099-03-01 19:00:00'}]}]]){
  const bad=await checkResy(food,input,mapping,env,async()=>json(response));assert.equal(bad.status,'provider_error');assert.deepEqual(bad.slots,[]);
 }
});
