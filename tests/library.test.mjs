import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addReels,readLibrary,analysisPhase,analyseReelURL} from '../lib/reel-library.ts';
import {browseProviderUrl,matches} from '../lib/travel.ts';
import reviewed from '../lib/catalog.json' with {type:'json'};
const sourceURL='https://www.instagram.com/reel/test/';
const completed=(id='done')=>({status:'analysis_completed',source:{id,source_url:sourceURL,platform:'Instagram',analysis_kind:'ai',creator:'Test creator',title:'Travel test',scope:'Places mentioned in the test',days:[],unknowns:[]},matches:[]});
test('shared and pasted aliases become one durable reel without replacing existing saves',()=>{
 const first=addReels([],['https://www.instagram.com/reel/abc/?tracking=yes']);
 const second=addReels(first,['https://instagram.com/p/abc','https://www.tiktok.com/@example/video/123']);
 assert.equal(second.length,2);assert.equal(second.find(r=>r.id==='instagram-abc').url,first[0].url);
 assert.deepEqual(readLibrary(JSON.stringify(second)),second);
});
test('invalid stored data is discarded and never treated as a reviewed reel',()=>{
 assert.deepEqual(readLibrary('{bad'),[]);
 assert.deepEqual(readLibrary(JSON.stringify([{url:'https://evil.test',id:'instagram-abc'}])),[]);
 assert.equal(analysisPhase('worker_required'),'unavailable');
 assert.equal(analysisPhase('reference_reviewed'),'reference');
 assert.equal(analysisPhase('analysis_cached'),'ready');
 assert.equal(analysisPhase('unexpected'),'error');
});
test('saving a short link never invents an analysis and library capacity is enforced',()=>{
 const [r]=addReels([],['https://vm.tiktok.com/abc/']);assert.equal(r.platform,'TikTok');
 assert.ok(!('analysis' in r));
 assert.throws(()=>addReels([],Array.from({length:101},(_,i)=>`https://instagram.com/reel/a${i}`)),/100/);
});
test('breakdown links work before dates without adding invented booking details',()=>{
 const stay=matches.find(m=>m.id==='roys'),food=matches.find(m=>m.id==='cafe-soul');
 const b=new URL(browseProviderUrl(stay,'Booking.com'));assert.equal(b.searchParams.has('checkin'),false);assert.match(b.searchParams.get('ss'),/Roy/);
 const f=new URL(browseProviderUrl(food,'OpenTable'));assert.equal(f.searchParams.has('dateTime'),false);assert.match(f.searchParams.get('term'),/Soul/);
});
test('one corrupt stored entry does not erase other valid saved reels',()=>{
 const valid=addReels([],['https://instagram.com/reel/keep']);
 const rows=[{url:'https://invalid.test',addedAt:new Date().toISOString()},...valid];
 assert.deepEqual(readLibrary(JSON.stringify(rows)),valid);
});
test('queued work is distinct from a completed or non-travel breakdown',()=>{
 assert.equal(analysisPhase('queued'),'loading');assert.equal(analysisPhase('processing'),'loading');
 assert.equal(analysisPhase('analysis_completed'),'ready');assert.equal(analysisPhase('not_travel'),'not_travel');
 assert.equal(analysisPhase('failed'),'error');assert.equal(analysisPhase('service_unavailable'),'unavailable');
});
test('processing polls sequentially using the job identifier and returns real completion',async()=>{
 const calls=[],updates=[],states=[{status:'queued',jobId:'test-job',stage:'queued'},{status:'processing',jobId:'test-job',stage:'analysing'},completed('done')];
 const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({clips:[states.shift()]});};
 const result=await analyseReelURL('https://instagram.com/reel/test',new AbortController().signal,c=>updates.push(c.status),fetcher,0);
 assert.deepEqual(updates,['queued','processing','analysis_completed']);assert.equal(result.source.id,'done');
 assert.equal(calls[0].options.method,'POST');assert.equal(calls[1].url,'/api/extract?job=test-job');assert.equal(calls[2].url,calls[1].url);
});
test('switching away aborts a pending poll without making another request',async()=>{
 const controller=new AbortController();let requests=0;
 await assert.rejects(analyseReelURL('https://instagram.com/reel/test',controller.signal,()=>controller.abort(),async()=>{requests++;return Response.json({clips:[{status:'queued',jobId:'test'}]});},10000));
 assert.equal(requests,1);
});
test('failed or malformed processing never turns into a completed breakdown',async()=>{
 const signal=new AbortController().signal;
 const failed=await analyseReelURL('url',signal,()=>{},async()=>Response.json({clips:[{status:'failed',message:'Video unavailable'}]}),0);
 assert.equal(failed.status,'failed');
 await assert.rejects(analyseReelURL('url',signal,()=>{},async()=>Response.json({clips:[{status:'processing'}]}),0),/resumed/);
 await assert.rejects(analyseReelURL('url',signal,()=>{},async()=>Response.json({error:'Capacity reached'},{status:429}),0),/Capacity/);
});
test('an explicit retry submits an expired restored job once again',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(url);return calls.length===1?Response.json({error:'Expired'},{status:404}):Response.json({clips:[completed('fresh')]});};
 const result=await analyseReelURL(sourceURL,new AbortController().signal,()=>{},fetcher,0,'old-job',true);assert.equal(result.source.id,'fresh');assert.deepEqual(calls,['/api/extract?job=old-job','/api/extract']);
});
test('explicit retry restarts a failed saved job once and polls the new job',async()=>{
 const calls=[],updates=[],states=[{status:'failed',jobId:'old',message:'Failed'},{status:'queued',jobId:'new'},completed('recovered')];
 const result=await analyseReelURL('https://instagram.com/reel/test',new AbortController().signal,c=>updates.push(c.status),async(url)=>{calls.push(url);return Response.json({clips:[states.shift()]});},0,'old',true);
 assert.equal(result.source.id,'recovered');assert.deepEqual(calls,['/api/extract?job=old','/api/extract','/api/extract?job=new']);assert.deepEqual(updates,['queued','analysis_completed']);
});
test('failed retries stop and background resume never silently starts another paid job',async()=>{
 for(const retry of [true,false]){
  let calls=0;const result=await analyseReelURL('url',new AbortController().signal,()=>{},async()=>{calls++;return Response.json({clips:[{status:'failed',jobId:'old'}]});},0,'old',retry);
  assert.equal(result.status,'failed');assert.equal(calls,retry?2:1);
 }
});
test('retry resumes an active job without another submission',async()=>{
 const calls=[],states=[{status:'processing',jobId:'working'},completed('done')];
 await analyseReelURL(sourceURL,new AbortController().signal,()=>{},async(url)=>{calls.push(url);return Response.json({clips:[states.shift()]});},0,'working',true);
 assert.deepEqual(calls,['/api/extract?job=working','/api/extract?job=working']);
});
test('background expiry never creates another paid job and explicit recovery cannot loop',async()=>{
 const calls=[];
 await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,()=>{},async(target,options)=>{calls.push(options.method||'GET');return new Response('Expired',{status:404});},0,'old',false),/expired/);
 assert.deepEqual(calls,['GET']);
 calls.length=0;
 await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,()=>{},async(target,options)=>{calls.push(options.method||'GET');return calls.length===2?Response.json({clips:[{status:'queued',jobId:'fresh'}]}):new Response('Expired',{status:404});},0,'old',true),/expired/);
 assert.deepEqual(calls,['GET','POST','GET']);
});
test('malformed progress, wrong job and unverified completion never reach the cache callback',async()=>{
 for(const clip of [{status:'processing'},{status:'processing',jobId:{}},{status:'processing',jobId:'different'},
  {status:'analysis_completed'},{...completed(),source:{...completed().source,source_url:'https://instagram.com/reel/other/'}},
  {status:'unexpected'},{status:'failed',message:{raw:'error'}}]){
  const updates=[];
  await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,c=>updates.push(c),async()=>Response.json({clips:[clip]}),0,'known'));
  assert.deepEqual(updates,[]);
 }
 for(const body of [null,{},[],{clips:[completed(),completed()]}]){
  const updates=[];
  await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,c=>updates.push(c),async()=>Response.json(body),0));
  assert.deepEqual(updates,[]);
 }
});
test('HTML errors and malformed JSON show safe recovery messages without automatic submission retries',async()=>{
 for(const status of [200,401,403,429,503]){
  let calls=0;
  await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,()=>{},async()=>{calls++;return new Response('<html>upstream diagnostic secret</html>',{status});},0),error=>!error.message.includes('secret')&&!error.message.includes('Unexpected token')&&/saved/.test(error.message));
  assert.equal(calls,1);
 }
});
test('an interrupted progress check can resume the existing job without another POST',async()=>{
 const calls=[],updates=[];
 await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,c=>updates.push(c),async(target,options)=>{
  calls.push({target,method:options.method||'GET'});
  if(calls.length===1)return Response.json({clips:[{status:'queued',jobId:'accepted'}]});
  throw new TypeError('Failed to fetch');
 },0),/connection was interrupted/i);
 assert.equal(updates.at(-1).jobId,'accepted');
 const result=await analyseReelURL(sourceURL,new AbortController().signal,()=>{},async(target,options)=>{calls.push({target,method:options.method||'GET'});return Response.json({clips:[completed()]});},0,updates.at(-1).jobId,true);
 assert.equal(result.status,'analysis_completed');assert.deepEqual(calls.map(call=>call.method),['POST','GET','GET']);
 assert.equal(calls[2].target,'/api/extract?job=accepted');
});
test('request timeout aborts the transport without retrying a possibly accepted submission',async()=>{
 let calls=0,requestSignal;
 await assert.rejects(analyseReelURL(sourceURL,new AbortController().signal,()=>{},async(target,options)=>{calls++;requestSignal=options.signal;return new Promise(()=>{});},0,undefined,false,5),{name:'TimeoutError'});
 assert.equal(calls,1);assert.equal(requestSignal.aborted,true);
});
test('caller cancellation stops a stalled request and suppresses late completion',async()=>{
 const controller=new AbortController(),updates=[];let finish;
 const pending=analyseReelURL(sourceURL,controller.signal,c=>updates.push(c),()=>new Promise(resolve=>{finish=resolve;}),0);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});
 finish(Response.json({clips:[completed()]}));await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(updates,[]);
});
test('cancellation during a final progress callback cannot return a completed result',async()=>{
 const controller=new AbortController();
 await assert.rejects(analyseReelURL(sourceURL,controller.signal,()=>controller.abort(),async()=>Response.json({clips:[completed()]}),0),{name:'AbortError'});
});
test('reviewed cached reels retain their attribution and never become AI results',async()=>{
 const source=reviewed[0],clip={status:'analysis_cached',source,matches:matches.filter(match=>match.source===source.id)};
 const result=await analyseReelURL(source.source_url,new AbortController().signal,()=>{},async()=>Response.json({clips:[clip]}),0);
 assert.equal(result.source.id,source.id);assert.equal(result.source.creator,source.creator);assert.equal(result.source.analysis_kind,undefined);
});
test('expired private jobs recover only through the upload endpoint and expired files never resubmit',async()=>{
 const uploadId='12345678-1234-1234-1234-123456789012',url='/api/upload?id='+uploadId,calls=[];
 const clip=await analyseReelURL(url,new AbortController().signal,()=>{},async(target,options)=>{calls.push({target,options});return calls.length===1?new Response('',{status:404}):Response.json({clips:[{status:'failed',message:'File unavailable'}]});},0,'old-upload-job',true);
 assert.equal(clip.status,'failed');assert.deepEqual(calls.map(call=>call.target),['/api/upload?job=old-upload-job','/api/upload']);
 assert.deepEqual(JSON.parse(calls[1].options.body),{uploadId,action:'analyse'});
 let requests=0;
 await assert.rejects(analyseReelURL(url,new AbortController().signal,()=>{},async()=>{requests++;return Response.json({error:'Original file expired'},{status:410});},0,'old-upload-job',true),/expired/);
 assert.equal(requests,1);
});
