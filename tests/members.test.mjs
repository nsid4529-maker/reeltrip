import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1} from './helpers/route-harness.mjs';
const {POST}=await import('../app/api/members/route.ts');
const {GET}=await import('../app/api/members/me/route.ts');

// Build the database from the real migrations, so the tests also check them.
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const create=(body,init={})=>POST(new Request('https://reeltrip.test/api/members',{method:'POST',headers:{'cf-connecting-ip':'203.0.113.30',...init.headers},body:typeof body==='string'?body:JSON.stringify(body)}));
const me=cookie=>GET(new Request('https://reeltrip.test/api/members/me',{headers:{'cf-connecting-ip':'203.0.113.30',...(cookie?{cookie}:{})}}));
const cookiePair=response=>response.headers.get('set-cookie').split(';')[0];

test('creating a member sets a secure device cookie and stores only a hash of it',async()=>{
 const {db}=d1(migrations);
 const response=await create({name:'  Priya  '});
 assert.equal(response.status,201);
 const member=await response.json();assert.equal(member.name,'Priya');assert.match(member.id,/^[0-9a-f-]{36}$/);
 const cookie=response.headers.get('set-cookie');
 assert.match(cookie,/^__Host-reeltrip_member=[0-9a-f]{64}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
 const token=cookiePair(response).split('=')[1],row=db.prepare('SELECT * FROM members').get();
 assert.equal(row.display_name,'Priya');assert.notEqual(row.token_hash,token);assert.ok(!JSON.stringify(row).includes(token),'the raw token is never stored');
});

test('/me returns the member for its cookie',async()=>{
 d1(migrations);
 const created=await create({name:'Sam'}),cookie=cookiePair(created),{id}=await created.json();
 const response=await me(cookie);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{id,name:'Sam'});
});

test('/me is 401 without a cookie or with an unknown one',async()=>{
 d1(migrations);
 assert.equal((await me()).status,401);
 assert.equal((await me('__Host-reeltrip_member='+'a'.repeat(64))).status,401);
 assert.equal((await me('__Host-reeltrip_member=not-a-token')).status,401);
});

test('invalid names are rejected and nothing is saved',async()=>{
 const {db}=d1(migrations);
 for(const name of ['','   ','x'.repeat(41),'Line\nbreak',42,null])assert.equal((await create({name})).status,400,JSON.stringify(name));
 assert.equal((await create('not json')).status,400);
 assert.equal((await create({name:'é'.repeat(40)})).status,201,'40 characters is allowed');
 assert.equal(db.prepare('SELECT count(*) AS n FROM members').get().n,1);
});

test('a device that already has a member keeps it instead of creating another',async()=>{
 const {db}=d1(migrations);
 const first=await create({name:'Alex'}),cookie=cookiePair(first),{id}=await first.json();
 const again=await create({name:'Someone else'},{headers:{cookie}});
 assert.equal(again.status,200);assert.equal((await again.json()).id,id);assert.equal(again.headers.get('set-cookie'),null);
 assert.equal(db.prepare('SELECT count(*) AS n FROM members').get().n,1);
});

test('cross-site requests are refused and creation is rate-limited',async()=>{
 d1(migrations);
 assert.equal((await create({name:'Eve'},{headers:{origin:'https://evil.example'}})).status,403);
 // 30 new names per network per day (see member-network-limit.test.mjs).
 const statuses=[];for(let i=0;i<31;i++)statuses.push((await create({name:'Guest '+i})).status);
 assert.deepEqual(statuses.slice(0,30),Array(30).fill(201));assert.equal(statuses[30],429);
});
