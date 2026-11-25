import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1} from './helpers/route-harness.mjs';
import {track} from '../lib/track.ts';
const {POST}=await import('../app/api/events/route.ts');
const members=await import('../app/api/members/route.ts');

const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const send=(body,headers={})=>POST(new Request('https://reeltrip.test/api/events',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.40',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
const rows=db=>db.prepare('SELECT member_id,name,bucket_id,props FROM events').all().map(r=>({...r}));

test('an allow-listed event is stored with its cleaned properties',async()=>{
 const {db}=d1(migrations);
 const response=await send({name:'reel_added',bucketId:'00000000-0000-4000-8000-000000000001',props:{source:'link',platform:'Instagram',destination:'trip',analyse:true}});
 assert.equal(response.status,204);
 assert.deepEqual(rows(db),[{member_id:null,name:'reel_added',bucket_id:'00000000-0000-4000-8000-000000000001',props:'{"source":"link","platform":"Instagram","destination":"trip","analyse":true}'}]);
});

test('events outside the allow-list, unknown properties and free text are refused',async()=>{
 const {db}=d1(migrations);
 const refused=[
  {name:'page_view'},
  {name:'reel_added',props:{caption:'Best tacos in Lisbon'}},
  {name:'reel_added',props:{source:'https://www.instagram.com/reel/abc/'}},
  {name:'place_viewed',props:{placeId:'someone@example.com'}},
  {name:'place_viewed',props:{placeId:'has spaces in it'}},
  {name:'plan_finished',props:{placeCount:-1}},
  {name:'vote_cast',props:{placeId:'p1',vote:'maybe'}},
  {name:'reel_added',props:['link']},
  {name:'member_joined',bucketId:'../../etc'},
 ];
 for(const body of refused)assert.equal((await send(body)).status,400,JSON.stringify(body));
 assert.equal((await send('not json')).status,400);
 assert.equal((await send('{"name":"member_joined","props":{"x":"'+'a'.repeat(3000)+'"}}')).status,413,'oversized bodies stop at the byte limit');
 assert.deepEqual(rows(db),[]);
});

test('the member comes from the device cookie, never from the request body',async()=>{
 const {db}=d1(migrations);
 const created=await members.POST(new Request('https://reeltrip.test/api/members',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.41'},body:JSON.stringify({name:'Jo'})}));
 const cookie=created.headers.get('set-cookie').split(';')[0],{id}=await created.json();
 assert.equal((await send({name:'member_joined',memberId:'someone-else'},{cookie})).status,204);
 assert.equal(rows(db)[0].member_id,id);
});

test('cross-site posts are refused and events are rate-limited per visitor',async()=>{
 const {db}=d1(migrations);
 assert.equal((await send({name:'member_joined'},{origin:'https://evil.example'})).status,403);
 let last;for(let i=0;i<1001;i++)last=await send({name:'member_joined'});
 assert.equal(last.status,429);
 assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,1000);
});

test('track() never throws or blocks, and drops events the allow-list would refuse',async()=>{
 const sent=[];
 assert.equal(track('reel_added',{source:'link',platform:'TikTok',destination:'individual',analyse:false},undefined,async(url,init)=>{sent.push([url,JSON.parse(init.body),init.keepalive]);return new Response(null,{status:204});}),undefined);
 assert.deepEqual(sent,[['/api/events',{name:'reel_added',props:{source:'link',platform:'TikTok',destination:'individual',analyse:false}},true]]);
 track('reel_added',{caption:'free text'},undefined,async()=>{sent.push('leaked');});
 track('not_an_event',{},undefined,async()=>{sent.push('leaked');});
 assert.equal(sent.length,1);
 assert.doesNotThrow(()=>track('member_joined',{},undefined,()=>{throw new Error('offline');}));
 assert.doesNotThrow(()=>track('member_joined',{},undefined,async()=>{throw new Error('offline');}));
 assert.doesNotThrow(()=>track('member_joined',{},undefined,undefined));
 await new Promise(resolve=>setTimeout(resolve,0));
});
