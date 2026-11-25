import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {d1,CORE_SCHEMA,withProcessor} from './helpers/route-harness.mjs';
const {startAnalysis}=await import('../lib/server/processing.ts');

// S1: the processor already returns the existing job for a URL it is working
// on. ReelTrip must not charge the visitor's analysis quota for that reuse.
const url='https://www.instagram.com/reel/SharedReel1/';
const providerId='00000000-0000-4000-8000-0000000000b2';
let restore=()=>{};
afterEach(()=>restore());
const request=ip=>new Request('https://reeltrip.test/api/extract',{headers:{'cf-connecting-ip':ip}});
const analysisCount=db=>db.prepare("SELECT COALESCE(SUM(count),0) AS n FROM usage_counters WHERE key LIKE 'analysis:%' AND key NOT LIKE '%:all'").get().n;

test('asking again for a URL that is already being analysed reuses the job without a second charge',async()=>{
 const {db}=d1(CORE_SCHEMA);const calls=[];
 restore=withProcessor(async(target,options)=>{calls.push(options.method);return Response.json({id:providerId,status:'queued',stage:'queued'});});
 const first=await startAnalysis(request('203.0.113.20'),url);
 const second=await startAnalysis(request('203.0.113.20'),url);
 assert.equal(second.jobId,first.jobId,'the same public job id is returned');
 assert.equal(analysisCount(db),1,'only the first request is charged');
 assert.deepEqual(calls,['POST','GET'],'the second request checks the existing job instead of submitting');
});

test('two simultaneous requests that the processor merges into one job are charged once',async()=>{
 const {db}=d1(CORE_SCHEMA);
 restore=withProcessor(async()=>{await new Promise(resolve=>setTimeout(resolve,5));return Response.json({id:providerId,status:'queued',stage:'queued'});});
 const [a,b]=await Promise.all([startAnalysis(request('203.0.113.21'),url),startAnalysis(request('203.0.113.21'),url)]);
 assert.equal(a.jobId,b.jobId);
 assert.equal(analysisCount(db),1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM processing_jobs').get().n,1);
 assert.equal(db.prepare("SELECT count FROM usage_counters WHERE key LIKE 'analysis:%:all'").get().count,1,'the site-wide cap is refunded too');
});

test('a failed earlier job does not block a fresh, charged retry',async()=>{
 const {db}=d1(CORE_SCHEMA);let posts=0;
 restore=withProcessor(async(target,options)=>{if(options.method==='GET')return Response.json({id:providerId,status:'failed',stage:'failed',error:{code:'media_timeout'}});posts++;return Response.json({id:posts===1?providerId:'00000000-0000-4000-8000-0000000000b3',status:'queued',stage:'queued'});});
 await startAnalysis(request('203.0.113.22'),url);
 const retry=await startAnalysis(request('203.0.113.22'),url);
 assert.equal(retry.status,'queued');assert.equal(posts,2);assert.equal(analysisCount(db),2);
});
