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
const eventsRoute=await import('../app/api/events/route.ts');

// Deleting a shared bucket removes everything linked to it, and nothing else.
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
let ip=0,sqlite;beforeEach(()=>{sqlite=d1(migrations).db;});
function person(){
 const headers={'cf-connecting-ip':'198.51.100.'+(++ip)};
 const call=async(handler,method,path,body)=>{const r=await handler(new Request('https://reeltrip.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));const c=r.headers.get('set-cookie');if(c)headers.cookie=c.split(';')[0];const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};};
 return {name:n=>call(membersRoute.POST,'POST','/api/members',{name:n}),create:n=>call(shared.POST,'POST','/api/shared',{name:n}),view:id=>call(bucketRoute.GET,'GET','/api/shared/bucket?id='+id),
  list:()=>call(shared.GET,'GET','/api/shared'),invite:id=>call(invites.POST,'POST','/api/shared/invites',{bucketId:id}),join:(t,n)=>call(join.POST,'POST','/api/shared/join',{token:t,name:n}),
  trip:(id,body)=>call(trip.POST,'POST','/api/shared/trip',{bucketId:id,...body}),agree:id=>call(shortlist.POST,'POST','/api/shared/shortlist',{bucketId:id,agreed:true}),
  event:(name,props,bucketId)=>call(eventsRoute.POST,'POST','/api/events',{name,props,bucketId}),
  remove:id=>call(bucketRoute.DELETE,'DELETE','/api/shared/bucket',{bucketId:id})};
}
const future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
// Reels, votes and bucket-scoped place fixes, as the analysis and places routes would leave them.
function fill(bucketId,memberIds,tag){
 const snap=JSON.stringify({source:{id:'s-'+tag,title:'Reel '+tag,creator:'c',platform:'Instagram',source_url:'https://www.instagram.com/reel/'+tag+'/'},places:[{id:'p-'+tag,title:'Café '+tag,place:'Ella',category:'Food',quote:'',second:3}]});
 sqlite.prepare("INSERT INTO bucket_reels (id,bucket_id,source_key,source_url,added_by,added_at,status,job_id,analysis,checked_at) VALUES (?,?,?,?,?,?,'ready',NULL,?,?)").run(crypto.randomUUID(),bucketId,'instagram:'+tag,'https://www.instagram.com/reel/'+tag+'/',memberIds[0],Date.now(),snap,Date.now());
 for(const m of memberIds)sqlite.prepare('INSERT INTO place_votes (bucket_id,place_key,member_id,value,updated_at) VALUES (?,?,?,1,?)').run(bucketId,'p-'+tag,m,Date.now());
 sqlite.prepare("INSERT INTO place_resolutions (scope,place_key,status,confidence,provider,provider_place_id,matched_at,verified_at,fixed_by) VALUES (?,?,'matched','confirmed','fixture','fixture_x',?,?,?)").run(bucketId,'p-'+tag,Date.now(),Date.now(),memberIds[0]);
}
const count=(table,where='1',...args)=>sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
const TABLES=[['shared_buckets','id'],['bucket_members','bucket_id'],['bucket_invites','bucket_id'],['bucket_reels','bucket_id'],['place_votes','bucket_id'],['place_resolutions','scope'],['events','bucket_id']];

test('the owner deletes a bucket and nothing linked to it is left; other buckets are untouched',async()=>{
 const mei=person(),ana=person(),raj=person();await mei.name('Mei');
 const lisbon=(await mei.create('Lisbon')).body.id,rome=(await mei.create('Rome')).body.id;
 const token=(await mei.invite(lisbon)).body.token;await ana.join(token,'Ana');await raj.join(token,'Raj');
 await mei.invite(lisbon);                                    // a second, still-active invite
 await ana.join((await mei.invite(rome)).body.token);          // Ana is in Rome too
 await mei.trip(lisbon,{start:future(30),end:future(33),travellers:3});await ana.agree(lisbon);
 const ids=Object.fromEntries(sqlite.prepare('SELECT id,display_name FROM members').all().map(r=>[r.display_name,r.id]));
 fill(lisbon,[ids.Mei,ids.Ana,ids.Raj],'L');fill(rome,[ids.Mei,ids.Ana],'R');
 await raj.event('vote_cast',{placeId:'p-L',vote:'up'},lisbon);await ana.event('place_viewed',{placeId:'p-R'},rome);
 await raj.event('place_viewed',{placeId:'p-L'});            // Raj's event outside any bucket
 const romeBefore=Object.fromEntries(TABLES.map(([t,c])=>[t,count(t,c+'=?',rome)]));
 for(const [t,c] of TABLES)assert.ok(count(t,c+'=?',lisbon)>0,'set-up put rows in '+t);

 assert.equal((await ana.remove(lisbon)).status,403,'an editor cannot delete');
 assert.equal((await person().remove(lisbon)).status,401,'a stranger cannot delete');
 const done=await mei.remove(lisbon);
 assert.equal(done.status,200);assert.deepEqual(done.body,{deleted:true,removedMembers:1});

 for(const [t,c] of TABLES)assert.equal(count(t,c+'=?',lisbon),0,'nothing left in '+t);
 assert.equal(count('members','display_name=?','Raj'),0,'Raj was only in Lisbon: his member record is gone');
 assert.equal(count('events','member_id=?',ids.Raj),0,'and so are his events, even outside the bucket');
 assert.equal(count('members','display_name IN (?,?)','Mei','Ana'),2,'Mei and Ana are still in Rome');
 assert.deepEqual(Object.fromEntries(TABLES.map(([t,c])=>[t,count(t,c+'=?',rome)])),romeBefore,'Rome is untouched');

 assert.equal((await mei.view(lisbon)).status,404,'the bucket is gone for its owner');
 assert.equal((await ana.view(lisbon)).status,404,'and for its members');
 assert.deepEqual((await mei.list()).body.buckets.map(b=>b.name),['Rome']);
 assert.equal((await person().join(token,'Zoe')).status,404,'its invite links no longer work');
 assert.equal((await raj.view(rome)).status,401,'Raj’s device is now a stranger');
 assert.equal((await mei.remove(lisbon)).status,404,'deleting twice is a plain not-found');
});

test('a sole owner who deletes their only bucket leaves no member, bucket or event behind',async()=>{
 const solo=person();await solo.name('Solo');const id=(await solo.create('Kyoto')).body.id;
 await solo.event('member_joined',{},id);
 assert.equal((await solo.remove(id)).body.removedMembers,1);
 for(const t of ['members','shared_buckets','bucket_members','events'])assert.equal(count(t),0,t);
});

test('only the owner sees Delete; it asks first, then leaves the bucket',async()=>{
 const {componentHarness,browserGlobals}=await import('./helpers/component-harness.mjs');
 const real=await import('../lib/shared-client.ts'),calls=[];
 const b=role=>({id:'00000000-0000-4000-8000-0000000000d1',name:'Lisbon',me:{id:role==='owner'?'m1':'m2',name:'x',role},members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}]});
 const render=async(role,answer)=>{const globals=browserGlobals();Object.assign(globals,{confirm:q=>{calls.push(['ask',q]);return answer;},location:{assign:u=>calls.push(['go',u])}});
  const h=await componentHarness('components/shared-bucket.tsx',{globals,expose:['DeleteBucket'],exportName:'DeleteBucket',props:{bucket:b(role)},modules:{'@/lib/track':{track(){}},'@/lib/shared-client':{...real,deleteShared:async id=>{calls.push(['delete',id]);return {deleted:true};}}}});await h.flush();return h;};
 const editor=await render('editor',true);
 assert.equal(editor.elements(n=>n.type==='button').length,0);assert.match(editor.text(),/Only Mei can delete this bucket/);
 const cancelled=await render('owner',false);await cancelled.elements(n=>n.type==='button')[0].props.onClick();
 assert.deepEqual(calls.map(c=>c[0]),['ask'],'cancelling deletes nothing');assert.match(calls[0][1],/for everyone.*can’t be undone/);
 calls.length=0;const owner=await render('owner',true);await owner.elements(n=>n.type==='button')[0].props.onClick();await owner.flush();
 assert.deepEqual(calls.slice(1),[['delete','00000000-0000-4000-8000-0000000000d1'],['go','/shared?deleted=1']]);
});
