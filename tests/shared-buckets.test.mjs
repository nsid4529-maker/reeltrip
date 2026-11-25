import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1,withProcessor} from './helpers/route-harness.mjs';
const shared=await import('../app/api/shared/route.ts');
const bucketRoute=await import('../app/api/shared/bucket/route.ts');
const invites=await import('../app/api/shared/invites/route.ts');
const join=await import('../app/api/shared/join/route.ts');
const reels=await import('../app/api/shared/reels/route.ts');
const votes=await import('../app/api/shared/votes/route.ts');
const membersRoute=await import('../app/api/members/route.ts');

// Shared buckets: every authorisation rule, then the main happy path.
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
// Reviewed catalogue reels have places without calling the processor.
const ELLA='https://www.tiktok.com/@jenseymour0/video/7567417996352834838',SHREYA='https://www.instagram.com/reel/DYJiRq2qMuA',KANISHA='https://www.instagram.com/reel/Dfulz8xs9MN';
let db,ip=0,restore=()=>{};
beforeEach(()=>{({db}=d1(migrations));restore=withProcessor(async()=>Response.json({id:'00000000-0000-4000-8000-0000000000c1',status:'queued',stage:'queued'}));});
afterEach(()=>restore());

// Each "person" is a separate device: its own IP and its own cookie.
function person(){
 const headers={'cf-connecting-ip':'198.51.100.'+(++ip)};
 const call=async(handler,method,path,body)=>{
  const response=await handler(new Request('https://reeltrip.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const cookie=response.headers.get('set-cookie');if(cookie)headers.cookie=cookie.split(';')[0];
  const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};
 };
 return {
  headers,
  name:async name=>call(membersRoute.POST,'POST','/api/members',{name}),
  create:async (name,reelUrls)=>call(shared.POST,'POST','/api/shared',{name,...(reelUrls?{reelUrls}:{})}),
  list:async()=>call(shared.GET,'GET','/api/shared'),
  view:async id=>call(bucketRoute.GET,'GET','/api/shared/bucket?id='+encodeURIComponent(id)),
  invite:async bucketId=>call(invites.POST,'POST','/api/shared/invites',{bucketId}),
  revoke:async (bucketId,inviteId)=>call(invites.DELETE,'DELETE','/api/shared/invites',{bucketId,inviteId}),
  preview:async token=>call(join.POST,'POST','/api/shared/join',{token,preview:true}),
  join:async (token,name)=>call(join.POST,'POST','/api/shared/join',{token,...(name?{name}:{})}),
  add:async (bucketId,url)=>call(reels.POST,'POST','/api/shared/reels',{bucketId,url}),
  remove:async (bucketId,reelId)=>call(reels.DELETE,'DELETE','/api/shared/reels',{bucketId,reelId}),
  vote:async (bucketId,placeKey,value)=>call(votes.POST,'POST','/api/shared/votes',{bucketId,placeKey,value}),
 };
}
async function ownerWithBucket(reelUrls){const owner=person();await owner.name('Aisha');const {body}=await owner.create('Lisbon',reelUrls);return {owner,id:body.id};}
async function invited(owner,id){return (await owner.invite(id)).body.token;}

test('a non-member gets 404 for every read and write, the same as a missing bucket',async()=>{
 const {owner,id}=await ownerWithBucket([ELLA]);
 const stranger=person();await stranger.name('Stranger');
 const place=(await owner.view(id)).body.reels[0].places[0].id,reel=(await owner.view(id)).body.reels[0].id;
 for(const result of [await stranger.view(id),await stranger.invite(id),await stranger.add(id,SHREYA),await stranger.remove(id,reel),await stranger.vote(id,place,1),await stranger.view('00000000-0000-4000-8000-00000000dead')])
  assert.equal(result.status,404,JSON.stringify(result.body));
 assert.deepEqual((await stranger.list()).body.buckets,[]);
});

test('a device with no member cannot use shared buckets',async()=>{
 const {id}=await ownerWithBucket();const guest=person();
 assert.equal((await guest.view(id)).status,401);assert.equal((await guest.create('Mine')).status,401);
});

test('a seventh member is refused, including two people joining at once',async()=>{
 const {owner,id}=await ownerWithBucket();const token=await invited(owner,id);
 for(let i=0;i<4;i++)assert.equal((await person().join(token,'Friend '+i)).status,201);
 const [sixth,seventh]=await Promise.all([person().join(token,'Sixth'),person().join(token,'Seventh')]);
 assert.deepEqual([sixth.status,seventh.status].sort(),[201,409]);
 assert.equal((await person().join(token,'Eighth')).status,409);
 assert.equal((await owner.view(id)).body.members.length,6);
 assert.equal((await owner.preview(token)).body.full,true);
});

test('expired and revoked invites are refused, and a made-up token is not valid',async()=>{
 const {owner,id}=await ownerWithBucket();
 const first=(await owner.invite(id)).body;
 assert.equal((await owner.revoke(id,first.id)).status,200);
 assert.equal((await person().join(first.token,'Late')).status,410);
 const second=(await owner.invite(id)).body;
 db.prepare('UPDATE bucket_invites SET expires_at=? WHERE id=?').run(Date.now()-1,second.id);
 assert.equal((await person().join(second.token,'Later')).status,410);
 assert.equal((await person().preview(second.token)).status,410);
 assert.equal((await person().join('f'.repeat(64),'Guess')).status,404);
 assert.ok(Date.parse(new Date(first.expiresAt).toISOString())-Date.now()>13*86400000,'invites last 14 days');
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM bucket_invites').all()).includes(second.token),'only token hashes are stored');
});

test('only the owner or the link maker can turn an invite off',async()=>{
 const {owner,id}=await ownerWithBucket();
 const editor=person();await editor.join(await invited(owner,id),'Editor');
 const ownersLink=(await owner.invite(id)).body,editorsLink=(await editor.invite(id)).body;
 assert.equal((await editor.revoke(id,ownersLink.id)).status,403);
 assert.equal((await editor.revoke(id,editorsLink.id)).status,200);
 assert.equal((await owner.revoke(id,ownersLink.id)).status,200);
});

test('one vote per member per place: changing replaces it, clearing removes it',async()=>{
 const {owner,id}=await ownerWithBucket([ELLA]);
 const place=(await owner.view(id)).body.reels[0].places[0].id;
 assert.equal((await owner.vote(id,place,1)).status,200);
 assert.equal((await owner.vote(id,place,1)).status,200);
 let tally=(await owner.view(id)).body.reels[0].places[0];assert.deepEqual([tally.up,tally.down,tally.myVote],[1,0,1]);
 await owner.vote(id,place,-1);tally=(await owner.view(id)).body.reels[0].places[0];assert.deepEqual([tally.up,tally.down,tally.myVote],[0,1,-1]);
 await owner.vote(id,place,0);tally=(await owner.view(id)).body.reels[0].places[0];assert.deepEqual([tally.up,tally.down,tally.myVote],[0,0,0]);
 assert.equal(db.prepare('SELECT count(*) AS n FROM place_votes').get().n,0);
 assert.equal((await owner.vote(id,'not-a-place-here',1)).status,400,'votes attach only to places in the bucket');
 assert.equal((await owner.vote(id,place,5)).status,400);
});

test('only whoever added a reel, or the owner, can remove it',async()=>{
 const {owner,id}=await ownerWithBucket();
 const sam=person(),jo=person();const token=await invited(owner,id);await sam.join(token,'Sam');await jo.join(token,'Jo');
 await sam.add(id,ELLA);await jo.add(id,SHREYA);
 const rows=(await owner.view(id)).body.reels,samsReel=rows.find(r=>r.addedBy.name==='Sam'),josReel=rows.find(r=>r.addedBy.name==='Jo');
 assert.equal((await jo.remove(id,samsReel.id)).status,403);
 assert.equal((await jo.view(id)).body.reels.find(r=>r.id===samsReel.id).canRemove,false);
 await jo.vote(id,josReel.places[0].id,1);
 assert.equal((await jo.remove(id,josReel.id)).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM place_votes').get().n,0,"the removed reel's votes go too");
 assert.equal((await owner.remove(id,samsReel.id)).status,200);
 assert.equal((await owner.view(id)).body.reels.length,0);
});

test('the same reel is never added or analysed twice in one bucket',async()=>{
 const {owner,id}=await ownerWithBucket();
 const calls=[];restore();restore=withProcessor(async(url,options)=>{calls.push(options.method);return Response.json({id:'00000000-0000-4000-8000-0000000000c2',status:'queued',stage:'queued'});});
 const fresh='https://www.instagram.com/reel/BrandNewReel1/';
 assert.equal((await owner.add(id,fresh)).status,201);
 assert.equal((await owner.add(id,'https://www.instagram.com/p/BrandNewReel1/')).status,200,'an alias of the same reel is the same reel');
 assert.deepEqual(calls,['POST'],'one analysis for one reel');
 const row=(await owner.view(id)).body.reels[0];assert.equal(row.status,'analysing');
 assert.equal((await owner.add(id,'https://example.com/not-a-reel')).status,400);
});

test('happy path: three phones share one bucket, each adds a reel and votes, and all see the same thing',async()=>{
 const aisha=person();await aisha.name('Aisha');
 const created=await aisha.create('Sri Lanka with friends',[ELLA,'upload-not-shareable']);
 assert.equal(created.status,201);assert.equal(created.body.skipped,1);
 const id=created.body.id,token=await invited(aisha,id);
 const ben=person(),cara=person();
 const preview=(await ben.preview(token)).body;
 assert.deepEqual([preview.bucketName,preview.ownerName,preview.members,preview.full],['Sri Lanka with friends','Aisha',1,false]);
 assert.equal((await ben.join(token,'Ben')).status,201);
 assert.equal((await cara.join(token,'Cara')).status,201);
 assert.equal((await cara.join(token)).status,200,'joining again is harmless');
 await ben.add(id,SHREYA);await cara.add(id,KANISHA);
 const view=(await aisha.view(id)).body,places=view.reels.flatMap(r=>r.places);
 await aisha.vote(id,places[0].id,1);await ben.vote(id,places[0].id,1);await cara.vote(id,places[0].id,-1);
 const seen=await Promise.all([aisha,ben,cara].map(async p=>{const b=(await p.view(id)).body;return {members:b.members.map(m=>m.name+':'+m.role),reels:b.reels.map(r=>r.title+' by '+r.addedBy.name),tally:b.reels[0].places[0].up+'/'+b.reels[0].places[0].down};}));
 assert.deepEqual(seen[0],seen[1]);assert.deepEqual(seen[1],seen[2]);
 assert.deepEqual(seen[0].members,['Aisha:owner','Ben:editor','Cara:editor']);
 assert.equal(seen[0].reels.length,3);assert.equal(seen[0].tally,'2/1');
 assert.equal((await cara.list()).body.buckets[0].members,3);
});
