import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadOwner} from '../lib/server/upload-owner.ts';
import {privateProcessorRequest,uploadHeaders,uploadLimiter,validateUploadMetadata,validateUploadJob,uploadReference} from '../lib/server/upload-client.ts';

const secret='test-only-owner-signing-secret-with-64-characters-and-no-real-value';
const id='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
const request=(cookie)=>new Request('https://reeltrip.example/api/upload',{headers:cookie?{cookie}:{}});
const cookieValue=identity=>identity.cookie.split(';')[0];

test('upload ownership is signed, unguessable and stable across save-only reloads',async()=>{
 const first=await uploadOwner(request(),secret,true),second=await uploadOwner(request(),secret,true);
 assert.match(first.owner,/^[0-9a-f]{64}$/);assert.notEqual(first.owner,second.owner);
 for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(first.cookie.includes(flag));
 assert.equal((await uploadOwner(request(cookieValue(first)),secret)).owner,first.owner);
 assert.equal((await uploadOwner(request(cookieValue(first)),secret,true)).cookie,undefined);
 await assert.rejects(uploadOwner(request(),secret));
 await assert.rejects(uploadOwner(request(cookieValue(first).slice(0,-1)+'z'),secret));
 await assert.rejects(uploadOwner(request(cookieValue(first)),secret+'changed'));
 await assert.rejects(uploadOwner(request(cookieValue(first)+'; '+cookieValue(second)),secret));
 assert.ok(!first.cookie.includes(first.owner));
});

test('upload request boundaries reject large or dishonest lengths, unsafe names and non-video types',()=>{
 const create=(headers={})=>new Request('https://reeltrip.example/api/upload',{method:'POST',headers:{'Content-Type':'video/mp4','X-Reel-Filename':'my%20video.mp4','X-Reel-Size':'3',...headers},body:'abc'});
 assert.deepEqual(uploadHeaders(create()),{size:3,mime:'video/mp4',filename:'my video.mp4'});
 for(const headers of [{'X-Reel-Size':'50000001'},{'X-Reel-Size':'-3'},{'X-Reel-Size':'0'},{'Content-Length':'2'},{'Content-Type':'text/html'},{'X-Reel-Filename':'bad%00.mp4'},{'X-Reel-Filename':'script.html'},{'X-Reel-Filename':'broken%XX.mp4'}])assert.throws(()=>uploadHeaders(create(headers)));
});

test('the streamed gateway counts actual bytes and rejects truncation without buffering the video',async()=>{
 const stream=chunks=>new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new Uint8Array(chunk));controller.close();}});
 assert.equal((await new Response(stream([2,3]).pipeThrough(uploadLimiter(5))).arrayBuffer()).byteLength,5);
 await assert.rejects(new Response(stream([3,3]).pipeThrough(uploadLimiter(5))).arrayBuffer(),/larger/);
 await assert.rejects(new Response(stream([3]).pipeThrough(uploadLimiter(5))).arrayBuffer(),/incomplete/);
});

test('private processor calls require a scoped owner, never follow redirects or expose credentials',async()=>{
 const config={url:'https://processor.example',token:secret};
 let called=0;
 const result=await privateProcessorRequest(config,'a'.repeat(64),'/v1/uploads/'+id+'/analysis','GET',async(url,options)=>{called++;assert.equal(options.headers['X-Upload-Owner'],'a'.repeat(64));assert.equal(options.headers.Authorization,'Bearer '+secret);assert.equal(options.redirect,'manual');return Response.json({ok:true});});
 assert.deepEqual(await result.json(),{ok:true});assert.equal(called,1);
 await assert.rejects(privateProcessorRequest(config,'', '/v1/uploads/'+id,'GET',async()=>assert.fail('must reject before network')));
 await assert.rejects(privateProcessorRequest(config,'a'.repeat(64),'https://evil.example','GET',async()=>assert.fail('must reject before network')));
 await assert.rejects(privateProcessorRequest(config,'a'.repeat(64),'/v1/uploads/'+id,'GET',async()=>new Response(secret,{status:302,headers:{Location:'https://evil.example'}})),error=>!error.message.includes(secret));
});

test('returned metadata and source identity are verified without reflecting upstream extras',()=>{
 const metadata={id,title:'My video.mp4',size:30,mimeType:'video/mp4',durationSeconds:12,addedAt:'2026-11-18T12:00:00Z',expiresAt:'2026-11-25T12:00:00Z',token:secret,file:'/private/file'};
 const clean=validateUploadMetadata(metadata);assert.equal(clean.token,undefined);assert.equal(clean.file,undefined);assert.match(clean.retentionMessage,/7 days/);
 for(const change of [{durationSeconds:181},{size:50000001},{mimeType:'text/html'},{id:'../../private'},{expiresAt:'2026-11-17T12:00:00Z'}])assert.throws(()=>validateUploadMetadata({...metadata,...change}));
 const result={id:job,uploadId:id,status:'complete',stage:'complete',result:{source:{id:'ai-upload-'+id,source_url:uploadReference(id),platform:'Uploaded video',analysis_kind:'ai',creator:'Your upload',scope:'Amsterdam',title:'Amsterdam canal cruise',days:[],unknowns:[]},matches:[]}};
 assert.equal(validateUploadJob(result,id,job).source.id,'ai-upload-'+id);
 assert.throws(()=>validateUploadJob({...result,uploadId:job},id,job));
 assert.throws(()=>validateUploadJob({...result,id},id,job));
 assert.throws(()=>validateUploadJob({...result,result:{...result.result,source:{...result.result.source,source_url:'https://instagram.com/reel/other'}}},id,job));
 assert.equal(validateUploadJob({id:job,uploadId:id,status:'failed',error:{code:'unknown',message:secret}},id).message.includes(secret),false);
});
