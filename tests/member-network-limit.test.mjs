import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1} from './helpers/route-harness.mjs';
const shared=await import('../app/api/shared/route.ts');
const invites=await import('../app/api/shared/invites/route.ts');
const join=await import('../app/api/shared/join/route.ts');
const membersRoute=await import('../app/api/members/route.ts');
const {MEMBERS_PER_NETWORK}=await import('../lib/server/processing.ts');

// Run-through finding: 10 new names per IP per day stopped the 11th person on one
// Wi-Fi, so a group of six could not finish joining after an organiser's own test.
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
beforeEach(()=>d1(migrations));
const HOME='192.0.2.50';
function device(ip=HOME){const headers={'cf-connecting-ip':ip};return async(handler,path,body)=>{const r=await handler(new Request('https://reeltrip.test'+path,{method:'POST',headers,body:JSON.stringify(body)}));const c=r.headers.get('set-cookie');if(c)headers.cookie=c.split(';')[0];return {status:r.status,body:await r.json()};};}

test('three groups of six can set up from one home network in a day',async()=>{
 assert.equal(MEMBERS_PER_NETWORK,30);
 for(let g=0;g<3;g++){
  const owner=device();assert.equal((await owner(membersRoute.POST,'/api/members',{name:'Owner '+g})).status,201);
  const id=(await owner(shared.POST,'/api/shared',{name:'Trip '+g})).body.id,token=(await owner(invites.POST,'/api/shared/invites',{bucketId:id})).body.token;
  for(let i=0;i<5;i++)assert.equal((await device()(join.POST,'/api/shared/join',{token,name:'Friend '+g+'-'+i})).status,201,'group '+g+' friend '+i);
 }
});

test('past the cap, the refusal says what to do',async()=>{
 for(let i=0;i<MEMBERS_PER_NETWORK;i++)assert.equal((await device('192.0.2.51')(membersRoute.POST,'/api/members',{name:'P'+i})).status,201);
 const refused=await device('192.0.2.51')(membersRoute.POST,'/api/members',{name:'One more'});
 assert.equal(refused.status,429);assert.match(refused.body.error,/from this network today\. Switch to mobile data/);
 assert.equal((await device('192.0.2.52')(membersRoute.POST,'/api/members',{name:'Elsewhere'})).status,201,'another network is unaffected');
});
