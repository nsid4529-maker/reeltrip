import test from 'node:test';
import assert from 'node:assert/strict';
import {readRequestBody} from '../lib/server/request-body.ts';
test('oversized streaming bodies are cancelled without reading the remainder',async()=>{
 let pulls=0,cancelled=false;
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1024));},cancel(){cancelled=true;}},{highWaterMark:0});
 const request=new Request('https://reeltrip.test/api/extract',{method:'POST',body,duplex:'half'});
 await assert.rejects(readRequestBody(request,2048),e=>e.status===413);
 assert.equal(pulls,3);assert.equal(cancelled,true);
});
test('body limits count UTF-8 bytes and reject false length headers',async()=>{
 const make=(body,headers={})=>new Request('https://reeltrip.test',{method:'POST',body,headers});
 assert.equal(await readRequestBody(make('café'),5),'café');
 await assert.rejects(readRequestBody(make('café'),4),e=>e.status===413);
 await assert.rejects(readRequestBody(make('small',{'content-length':'10000'}),8),e=>e.status===413);
 await assert.rejects(readRequestBody(make('oversized',{'content-length':'1'}),8),e=>e.status===413);
});
