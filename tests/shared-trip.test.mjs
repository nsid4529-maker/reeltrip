import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1} from './helpers/route-harness.mjs';
const shared=await import('../app/api/shared/route.ts');
const bucketRoute=await import('../app/api/shared/bucket/route.ts');
const invites=await import('../app/api/shared/invites/route.ts');
const join=await import('../app/api/shared/join/route.ts');
const trip=await import('../app/api/shared/trip/route.ts');
const shortlist=await import('../app/api/shared/shortlist/route.ts');
const membersRoute=await import('../app/api/members/route.ts');
const {tripDetails}=await import('../lib/server/shared-buckets.ts');

const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
let ip=0;beforeEach(()=>d1(migrations));
function person(){
 const headers={'cf-connecting-ip':'203.0.113.'+(++ip)};
 const call=async(handler,method,path,body)=>{const r=await handler(new Request('https://reeltrip.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));const c=r.headers.get('set-cookie');if(c)headers.cookie=c.split(';')[0];const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};};
 return {name:n=>call(membersRoute.POST,'POST','/api/members',{name:n}),create:n=>call(shared.POST,'POST','/api/shared',{name:n}),view:id=>call(bucketRoute.GET,'GET','/api/shared/bucket?id='+id),
  invite:id=>call(invites.POST,'POST','/api/shared/invites',{bucketId:id}),join:(t,n)=>call(join.POST,'POST','/api/shared/join',{token:t,name:n}),
  trip:(id,body)=>call(trip.POST,'POST','/api/shared/trip',{bucketId:id,...body}),agree:(id,agreed)=>call(shortlist.POST,'POST','/api/shared/shortlist',{bucketId:id,agreed})};
}
async function group(){const owner=person();await owner.name('Mei');const id=(await owner.create('Lisbon')).body.id;const token=(await owner.invite(id)).body.token;const ana=person(),raj=person();await ana.join(token,'Ana');await raj.join(token,'Raj');return {owner,ana,raj,id};}
const future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);

test('trip detail validation',()=>{
 const today='2026-11-22';
 assert.deepEqual(tripDetails({start:'2026-12-03',end:'2026-12-06',travellers:4},today),{start:'2026-12-03',end:'2026-12-06',travellers:4});
 assert.deepEqual(tripDetails({start:'',end:'',travellers:''},today),{start:null,end:null,travellers:null},'clearing is allowed');
 for(const [input,why] of [[{start:'2026-12-03'},'one date only'],[{start:'2026-12-06',end:'2026-12-06'},'zero nights'],[{start:'2026-12-06',end:'2026-12-03'},'end before start'],[{start:'2026-11-21',end:'2026-11-25'},'in the past'],
  [{start:'2026-12-01',end:'2027-02-15'},'over 60 nights'],[{start:'2026-02-30',end:'2026-03-02'},'not a real date'],[{start:'03/12/2026',end:'06/12/2026'},'wrong format'],
  [{travellers:0},'too few'],[{travellers:13},'too many'],[{travellers:2.5},'not whole'],[{travellers:'4'},'not a number']])
  assert.throws(()=>tripDetails(input,today),/./,why);
});

test('travellers default to the member count; only the owner can change trip details',async()=>{
 const {owner,ana,id}=await group();
 let view=(await ana.view(id)).body;assert.deepEqual(view.trip,{start:null,end:null,travellers:3,travellersSet:false});
 assert.equal((await ana.trip(id,{start:future(10),end:future(13),travellers:4})).status,403);
 assert.equal((await owner.trip(id,{start:future(10),end:future(13),travellers:4})).status,200);
 view=(await ana.view(id)).body;assert.deepEqual(view.trip,{start:future(10),end:future(13),travellers:4,travellersSet:true});
 assert.equal((await owner.trip(id,{start:future(13),end:future(10)})).status,400);
 assert.equal((await owner.trip(id,{start:'',end:'',travellers:null})).status,200,'details can be changed later and cleared');
 assert.equal((await ana.view(id)).body.trip.start,null);
 assert.equal((await person().trip(id,{start:future(10),end:future(13)})).status,401);
});

test('any member can mark the shortlist agreed, with who and when, and undo it',async()=>{
 const {ana,raj,id}=await group();
 assert.equal((await raj.view(id)).body.shortlist,null);
 assert.equal((await ana.agree(id,true)).status,200);
 const agreed=(await raj.view(id)).body.shortlist;
 assert.equal(agreed.by.name,'Ana');assert.ok(Math.abs(agreed.at-Date.now())<5000);
 assert.equal((await raj.agree(id,false)).status,200,'any member can undo');
 assert.equal((await raj.view(id)).body.shortlist,null);
 assert.equal((await raj.agree(id,'yes')).status,400);
 const outsider=person();await outsider.name('Out');assert.equal((await outsider.agree(id,true)).status,404);
});
