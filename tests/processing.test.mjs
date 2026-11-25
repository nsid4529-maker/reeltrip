import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnalysis} from '../lib/analysis.ts';
import {processorRequest,processorConfig} from '../lib/server/processing-client.ts';
const url='https://www.instagram.com/reel/example/';
const id='12345678-1234-1234-1234-123456789012';
const config={url:'https://processor.example',token:'private-test-token'};
const source={id:'ai-example',source_url:url,platform:'Instagram',analysis_kind:'ai',creator:'Unknown',scope:'Tokyo',title:'Tokyo highlights',days:[{day:0,items:[{details:'Temple',time_seconds:[0,4]}]}],unknowns:['Dates unknown']};
const match={id:'one',source:source.id,title:'Temple',place:'Tokyo',query:'Tokyo temple',category:'Experiences',kind:'Named',quote:'Temple',second:1,providers:['Malicious'],direct:'https://evil.test'};
test('AI analysis preserves unassigned highlights and controls outbound providers',()=>{
 const result=validateAnalysis({source,matches:[match]},url);assert.equal(result.source.days[0].day,0);assert.deepEqual(result.matches[0].providers,['Viator','GetYourGuide']);assert.equal(result.matches[0].direct,undefined);
 assert.throws(()=>validateAnalysis({source:{...source,source_url:'https://instagram.com/reel/different'},matches:[]},url));
 assert.throws(()=>validateAnalysis({source,matches:[match,match]},url));
});
test('content-rich results accept all 32 supported highlights without dropping two',()=>{
 const items=Array.from({length:32},(_,i)=>({details:'Place '+i,time_seconds:[i,i+1]}));
 const full={source:{...source,days:[{day:0,items}]},matches:items.map((_,i)=>({...match,id:'place-'+i}))};
 assert.equal(validateAnalysis(full,url).source.days[0].items.length,32);
 assert.throws(()=>validateAnalysis({...full,source:{...full.source,days:[{day:0,items:[...items,items[0]]}]}},url));
 assert.throws(()=>validateAnalysis({...full,source:{...full.source,days:[{day:0,items:items.slice(0,20)},{day:1,items:items.slice(0,20)}]}},url));
});
test('processor credentials never appear in job results or error messages',async()=>{
 const result=await processorRequest(config,url,undefined,async (target,request)=>{assert.equal(target,'https://processor.example/v1/jobs');assert.equal(request.headers.Authorization,'Bearer private-test-token');return Response.json({id,status:'queued',stage:'queued'});});assert.equal(result.status,'queued');assert.ok(!JSON.stringify(result).includes(config.token));
 await assert.rejects(processorRequest(config,url,undefined,async()=>new Response(config.token,{status:500})),e=>!e.message.includes(config.token));
});
test('completed jobs verify identity and shortlink provenance before exposing analysis',async()=>{
 const fetcher=async()=>Response.json({id,status:'complete',stage:'complete',result:{source,matches:[match]}});
 assert.equal((await processorRequest(config,url,id,fetcher)).analysis.source.id,source.id);
 await assert.rejects(processorRequest(config,'https://vm.tiktok.com/abc/',id,fetcher));
 await assert.rejects(processorRequest(config,url,'other-job',fetcher));
});
test('nontravel results never invent an itinerary and configuration requires HTTPS',async()=>{
 const result=await processorRequest(config,url,id,async()=>Response.json({id,status:'complete',result:{not_travel:true}}));assert.ok(result.notTravel);assert.equal(result.analysis,undefined);
 assert.equal(processorConfig({REELTRIP_PROCESSOR_URL:'http://localhost',REELTRIP_PROCESSOR_TOKEN:'x'}),null);
});
test('edge requests refuse upstream redirects without forwarding credentials',async()=>{
 let calls=0;await assert.rejects(processorRequest(config,url,undefined,async(target,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.example'}});}));assert.equal(calls,1);
});
test('source-access, duration and model failures remain distinct without leaking upstream text',async()=>{
 for(const [code,expected] of [['source_unavailable',/restrict access/],['video_too_long',/three minutes/],['analysis_invalid',/reliably match/],['service_restarted',/interrupted/],['unknown_code',/fresh analysis/]]){
  const job=await processorRequest(config,url,id,async()=>Response.json({id,status:'failed',error:{code,message:config.token}}));
  assert.match(job.message,expected);assert.ok(!job.message.includes(config.token));assert.equal(job.analysis,undefined);
 }
});

test('blocked social-video acquisition offers a saved-file alternative and never treats the failure as analysis',async()=>{
 const tiktok='https://www.tiktok.com/@ambardriscoll/video/7703925873447128323';
 const job=await processorRequest(config,tiktok,id,async()=>Response.json({id,status:'failed',error:{code:'source_unavailable',message:'raw provider response '+config.token}}));
 assert.equal(job.status,'failed');assert.equal(job.analysis,undefined);
 assert.match(job.message,/upload a saved video file/);assert.match(job.message,/Your reel is saved/);assert.ok(!job.message.includes(config.token));
});
test('missing existing worker jobs retain expiry status while failed submissions remain unavailable',async()=>{
 const missing=async()=>new Response('private upstream diagnostic '+config.token,{status:404});
 await assert.rejects(processorRequest(config,url,id,missing),error=>error.status===404&&/expired/.test(error.message)&&!error.message.includes(config.token));
 await assert.rejects(processorRequest(config,url,undefined,missing),error=>error.status===503&&!error.message.includes(config.token));
});
