import {afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {d1,CORE_SCHEMA,withProcessor} from './helpers/route-harness.mjs';
const {POST}=await import('../app/api/extract/route.ts');

// S2: one failing link must not discard a job already started for another.
const first='https://www.instagram.com/reel/FirstReel01/',second='https://www.instagram.com/reel/SecondReel2/';
const jobId='00000000-0000-4000-8000-0000000000a1';
let restore=()=>{};
afterEach(()=>restore());
const post=urls=>POST(new Request('https://reeltrip.test/api/extract',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.9'},body:JSON.stringify({urls})}));

test('a processor failure on a later link keeps the job started for the earlier one',async()=>{
 d1(CORE_SCHEMA);const calls=[];
 restore=withProcessor(async(url,options)=>{const body=JSON.parse(options.body);calls.push(body.url);return body.url===first?Response.json({id:jobId,status:'queued',stage:'queued'}):new Response('busy',{status:503});});
 const response=await post([first,second]);
 assert.equal(response.status,200);
 const {clips}=await response.json();
 assert.equal(clips.length,2);
 assert.equal(clips[0].status,'queued');assert.ok(clips[0].jobId,'the started job stays pollable');
 assert.equal(clips[1].status,'error');assert.equal(clips[1].url,second);assert.match(clips[1].message,/temporarily unavailable/);
 assert.deepEqual(calls,[first,second]);
});

test('an invalid link is rejected before any paid analysis starts',async()=>{
 d1(CORE_SCHEMA);const calls=[];
 restore=withProcessor(async(url,options)=>{calls.push(JSON.parse(options.body).url);return Response.json({id:jobId,status:'queued',stage:'queued'});});
 const response=await post([first,'https://www.youtube.com/watch?v=nope']);
 assert.equal(response.status,400);
 assert.deepEqual(calls,[],'no processor job may start for a request that is going to be rejected');
});

test('a single failing link still returns an HTTP error with its message',async()=>{
 d1(CORE_SCHEMA);
 restore=withProcessor(async()=>new Response('busy',{status:429}));
 const response=await post([first]);
 assert.equal(response.status,429);
 assert.match((await response.json()).error,/busy/);
});
