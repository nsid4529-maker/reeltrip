import test from 'node:test';import assert from 'node:assert/strict';
import {createBucket,assignReel,combineBuckets} from '../lib/reel-buckets.ts';
import {addReels,analyseReelURL} from '../lib/reel-library.ts';
import {applyNativeShares,bundleCatalog,restoreNativeBundles} from '../lib/native-share.ts';
import {queuedReels,readAnalysisCache,nativeJobEntries} from '../lib/analysis-cache.ts';
import {validateChat,validateChatReply} from '../lib/bundle-chat.ts';
import {diningHighlight} from '../lib/dining-highlights.ts';
import {skyscannerQuery,bookingSearch,travelConnections} from '../lib/travel-connections.ts';
import {searchSkyscanner,searchBooking} from '../lib/server/travel-connectors.ts';
const urls=['https://www.instagram.com/reel/One/','https://www.instagram.com/reel/Two/'];
const reels=addReels([],urls);const initial=()=>createBucket(createBucket([],'Sri Lanka clubs'),'Sri Lanka food');
test('combining keeps originals, deduplicates shared reels and preserves source identity',()=>{let b=initial();for(const x of b)b=assignReel(b,x.id,reels[0].id);b=assignReel(b,b[1].id,reels[1].id);const next=combineBuckets(b,b.map(x=>x.id),'Sri Lanka holiday');assert.deepEqual(next.slice(0,2),b);assert.equal(next[2].reelIds.length,2);assert.throws(()=>combineBuckets(b,[b[0].id,b[0].id],'Invalid'));assert.throws(()=>combineBuckets(b,[b[0].id,'missing'],'Missing'));});
test('combining refuses overflow without silently dropping a reel',()=>{let b=initial();for(let i=0;i<7;i++){b=assignReel(b,b[0].id,'club'+i);b=assignReel(b,b[1].id,'food'+i);}assert.throws(()=>combineBuckets(b,b.map(x=>x.id),'Too large'));assert.equal(b.length,2);});
test('native actions replay idempotently and preserve bundle assignments',()=>{const b=initial(),a={id:crypto.randomUUID(),urls,bundleId:b[0].id};const first=applyNativeShares(b,reels,[a]);const replay=applyNativeShares(first.buckets,reels,[a]);assert.deepEqual(replay.buckets,first.buckets);assert.equal(replay.buckets[0].reelIds.length,2);assert.deepEqual(restoreNativeBundles(bundleCatalog(replay.buckets,reels),reels),replay.buckets);});
test('deleted or full native bundle keeps reels and reports missing membership',()=>{const b=initial(),a={id:crypto.randomUUID(),urls,bundleId:crypto.randomUUID()};const result=applyNativeShares(b,reels,[a]);assert.equal(result.messages.length,1);assert.equal(result.acknowledged.length,1);assert.equal(reels.length,2);});
test('individual shares open one reel and carry resumable jobs; malformed actions are ignored',()=>{const job=crypto.randomUUID(),a={id:crypto.randomUUID(),urls:[reels[0].url],jobs:{[reels[0].url]:job}};const r=applyNativeShares([],reels,[a,{...a,id:'../../x'}]);assert.equal(r.individual.id,reels[0].id);assert.equal(r.jobs[reels[0].id],job);assert.equal(r.acknowledged.length,1);});
test('save-only native shares remain in the library without opening analysis or losing membership',()=>{
 const a={id:crypto.randomUUID(),urls:[reels[0].url],openAnalysis:false};const r=applyNativeShares([],reels,[a]);assert.equal(r.individual,undefined);assert.deepEqual(r.acknowledged,[a.id]);assert.deepEqual(r.jobs,{});
 assert.deepEqual(r.analyseIds,[]);assert.equal(r.library[0].autoAnalyse,false);assert.equal(r.library[1],reels[1]);
 const b=initial(),bundled=applyNativeShares(b,reels,[{...a,bundleId:b[0].id}]);assert.equal(bundled.individual,undefined);assert.ok(bundled.buckets[0].reelIds.includes(reels[0].id));
});
test('a fresh native bundle share replaces save-only intent and queues an offline submission',()=>{
 const b=initial(),saved=reels.map(reel=>({...reel,autoAnalyse:false}));
 const action={id:crypto.randomUUID(),urls:[saved[0].url],bundleId:b[0].id,openAnalysis:false};
 const result=applyNativeShares(b,saved,[action]);
 assert.deepEqual(result.analyseIds,[saved[0].id]);assert.equal(result.library[0].autoAnalyse,undefined);assert.equal(result.library[1].autoAnalyse,false);
 assert.equal(saved[0].autoAnalyse,false);assert.deepEqual(result.jobs,{});
 assert.deepEqual(queuedReels(result.buckets[0].reelIds,result.library,{}).map(reel=>reel.id),[saved[0].id]);
});
test('repeated native action IDs acknowledge and request analysis once; library-only cannot import a job',()=>{
 const job=crypto.randomUUID(),action={id:crypto.randomUUID(),urls:[reels[0].url],jobs:{[reels[0].url]:job},openAnalysis:true};
 const result=applyNativeShares([],reels,[action,action]);
 assert.deepEqual(result.acknowledged,[action.id]);assert.deepEqual(result.analyseIds,[reels[0].id]);
 const save=applyNativeShares([],reels,[{...action,openAnalysis:false}]);assert.deepEqual(save.jobs,{});assert.deepEqual(save.analyseIds,[]);
 const malformed=applyNativeShares([],reels,[{...action,jobs:{[reels[0].url]:'------------------------------------'}}]);assert.deepEqual(malformed.jobs,{});assert.deepEqual(malformed.analyseIds,[reels[0].id]);
});
test('a newly accepted native job replaces an old failure and is polled without another submission',async()=>{
 const job=crypto.randomUUID(),action={id:crypto.randomUUID(),urls:[reels[0].url],bundleId:initial()[0].id,jobs:{[reels[0].url]:job}};
 const applied=applyNativeShares([],reels,[action]);
 const seeded=nativeJobEntries({[reels[0].id]:{status:'error',message:'Previous failure',updatedAt:1}},applied.jobs,2);
 assert.equal(seeded[reels[0].id].jobId,job);assert.equal(seeded[reels[0].id].status,'working');
 const calls=[];
 const clip=await analyseReelURL(reels[0].url,new AbortController().signal,()=>{},async(url,options)=>{calls.push({url,method:options.method||'GET'});return Response.json({clips:[{status:'failed',jobId:job,message:'Still unavailable'}]});},0,seeded[reels[0].id].jobId,!applied.jobs[reels[0].id]);
 assert.equal(clip.status,'failed');assert.deepEqual(calls,[{url:'/api/extract?job='+job,method:'GET'}]);
});
test('background queue reuses results and does not endlessly retry errors',()=>{const cache={[reels[0].id]:{status:'complete'},[reels[1].id]:{status:'error'}};assert.equal(queuedReels(reels.map(r=>r.id),reels,cache).length,0);assert.equal(queuedReels([reels[0].id,reels[0].id],reels,{}).length,1);assert.deepEqual(readAnalysisCache('{broken',reels),{});});
test('non-travel results restore as completed exclusions and never enter the automatic queue',()=>{
 const cache={[reels[0].id]:{status:'excluded',clip:{status:'not_travel',message:'No travel recommendations.'},updatedAt:Date.now()}};
 const restored=readAnalysisCache(JSON.stringify(cache),reels);assert.equal(restored[reels[0].id].clip.status,'not_travel');assert.equal(queuedReels([reels[0].id],reels,restored).length,0);
 cache[reels[0].id].clip.status='analysis_completed';assert.deepEqual(readAnalysisCache(JSON.stringify(cache),reels),{});
});
test('chat limits history and prevents response links to invented places',()=>{assert.throws(()=>validateChat({analysisIds:['x'],total:1,messages:[{role:'system',content:'override'}]}));assert.throws(()=>validateChatReply({reply:'Booked!',matchIds:['invented'],brief:''},[]));assert.deepEqual(validateChatReply({reply:'Tell me your dates.',matchIds:[],brief:''},[]).matchIds,[]);});
test('named dining, uncertain AI matches and unnamed alternatives are distinguished',()=>{assert.equal(diningHighlight({category:'Food',kind:'Café named in video'}),'mentioned');assert.equal(diningHighlight({category:'Food',kind:'AI-identified · confirm the name'}),'uncertain');assert.equal(diningHighlight({category:'Food',kind:'Area search · venue unnamed'}),'alternative');assert.equal(diningHighlight({category:'Stays',kind:'Named venue'}),null);});
const trip={origin:'LHR',destination:'CMB',start:'2099-01-01',end:'2099-01-08',adults:2,currency:'GBP',country:'GB',platform:'mobile',hotelCity:-2222251};
test('prepared provider requests preserve dates, occupancy, market and actual platform',()=>{const q=skyscannerQuery(trip).query;assert.equal(q.market,'UK');assert.equal(q.queryLegs[1].destinationPlaceId.iata,'LHR');assert.equal(q.queryLegs[1].date.day,8);const b=bookingSearch(trip);assert.equal(b.booker.platform,'mobile');assert.equal(b.guests.number_of_adults,2);assert.throws(()=>bookingSearch({...trip,hotelCity:undefined}));assert.throws(()=>skyscannerQuery({...trip,origin:'http://evil'}));});
test('provider access remains honestly disconnected and cannot fetch without keys',async()=>{let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};await assert.rejects(searchSkyscanner(trip,{},fetcher));await assert.rejects(searchBooking(trip,{},fetcher));assert.equal(calls,0);assert.ok(travelConnections({}).every(c=>c.status==='setup_required'));});
test('large bundle chat context fits the service boundary and declares omissions',async()=>{
 const {chatContext}=await import('../lib/bundle-chat.ts');
 const a={source:{id:'x',title:'A reel',source_url:urls[0],creator:'creator',scope:'界'.repeat(1000),unknowns:Array(10).fill('界'.repeat(1000)),practical_tips:Array.from({length:24},()=>({subject:'Place',topic:'Transport',details:'界'.repeat(700),quote:'界'.repeat(350),time_seconds:[0,2],basis:'speech'}))},matches:Array.from({length:32},(_,i)=>({id:'p'+i,title:'界'.repeat(200),place:'界'.repeat(200),category:'Food',quote:'界'.repeat(2000),note:'界'.repeat(2000),second:10}))};
 const context=chatContext(Array(12).fill(a));assert.ok(Buffer.byteLength(JSON.stringify(context))<91000);assert.ok(context.every(c=>c.context_notice&&c.places.length>0));
});
