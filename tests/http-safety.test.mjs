import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedText,boundedJSON,quotaVisitor,secureResponse} from '../lib/server/http-safety.ts';
import {processorRequest} from '../lib/server/processing-client.ts';

test('slow bodies time out and cancel their stream',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
 await assert.rejects(boundedText(response,100,20),e=>e.status===408);
 assert.equal(cancelled,true);
});
test('processor responses are bounded before buffering and never expose upstream secrets',async()=>{
 let pulls=0,cancelled=false;
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(60000));},cancel(){cancelled=true;}},{highWaterMark:0});
 await assert.rejects(processorRequest({url:'https://worker.test',token:'private'},'https://www.instagram.com/p/test/',undefined,async()=>new Response(body)),e=>e.status===503);
 assert.equal(pulls,4);assert.equal(cancelled,true);
 await assert.rejects(boundedJSON(new Response('UPSTREAM SECRET')),e=>!e.message.includes('SECRET'));
 await assert.rejects(boundedText(new Response(new Uint8Array([0xff])),4),e=>e.status===400);
});
test('forwarded headers cannot select a different rate-limit bucket',()=>{
 const h=new Headers({'cf-connecting-ip':'203.0.113.10','x-forwarded-for':'attacker','x-real-ip':'attacker','forwarded':'for=attacker'});
 assert.equal(quotaVisitor(h),'203.0.113.10');
 h.set('x-forwarded-for','someone-else');assert.equal(quotaVisitor(h),'203.0.113.10');
 h.delete('cf-connecting-ip');assert.equal(quotaVisitor(h),'unknown');
});
test('API responses including errors cannot be cached; embedded sources are restricted',async()=>{
 const response=secureResponse(new Response('error',{status:503,headers:{'Cache-Control':'public,max-age=500'}}),true);
 assert.equal(response.status,503);assert.equal(await response.text(),'error');
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.match(response.headers.get('content-security-policy'),/frame-src 'self' https:\/\/www.instagram.com https:\/\/www.tiktok.com https:\/\/widget.getyourguide.com https:\/\/widgets.skyscanner.net https:\/\/www.skyscanner.net;/);
 assert.match(response.headers.get('permissions-policy'),/microphone=\(\)/);
});
