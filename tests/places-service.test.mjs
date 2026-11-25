import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {d1} from './helpers/route-harness.mjs';
const resolveRoute=await import('../app/api/places/resolve/route.ts');
const searchRoute=await import('../app/api/places/search/route.ts');
const detailsRoute=await import('../app/api/places/details/route.ts');
const fixRoute=await import('../app/api/places/fix/route.ts');
const shared=await import('../app/api/shared/route.ts');
const bucketRoute=await import('../app/api/shared/bucket/route.ts');
const invites=await import('../app/api/shared/invites/route.ts');
const join=await import('../app/api/shared/join/route.ts');
const votes=await import('../app/api/shared/votes/route.ts');
const membersRoute=await import('../app/api/members/route.ts');

const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const SIGIRIYA='https://www.tiktok.com/@jenseymour0/video/7563685804980194582';
const DAY=86400000;
let db,ip=0;const saved={...process.env},savedFetch=globalThis.fetch;
beforeEach(()=>{({db}=d1(migrations));delete process.env.GOOGLE_PLACES_API_KEY;delete process.env.PLACES_PROVIDER;});
afterEach(()=>{process.env=saved;Object.assign(process.env,saved);globalThis.fetch=savedFetch;delete process.env.GOOGLE_PLACES_API_KEY;delete process.env.PLACES_PROVIDER;});

function person(){
 const headers={'cf-connecting-ip':'192.0.2.'+(++ip)};
 const call=async(handler,method,path,body)=>{const r=await handler(new Request('https://reeltrip.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));const c=r.headers.get('set-cookie');if(c)headers.cookie=c.split(';')[0];const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null};};
 return {
  resolve:(places,bucketId)=>call(resolveRoute.POST,'POST','/api/places/resolve',{places,...(bucketId?{bucketId}:{})}),
  search:query=>call(searchRoute.POST,'POST','/api/places/search',{query}),
  details:id=>call(detailsRoute.GET,'GET','/api/places/details?id='+encodeURIComponent(id)),
  fix:body=>call(fixRoute.POST,'POST','/api/places/fix',body),
  name:name=>call(membersRoute.POST,'POST','/api/members',{name}),
  create:(name,reelUrls)=>call(shared.POST,'POST','/api/shared',{name,reelUrls}),
  view:id=>call(bucketRoute.GET,'GET','/api/shared/bucket?id='+id),
  invite:bucketId=>call(invites.POST,'POST','/api/shared/invites',{bucketId}),
  join:(token,name)=>call(join.POST,'POST','/api/shared/join',{token,name}),
  vote:(bucketId,placeKey,value)=>call(votes.POST,'POST','/api/shared/votes',{bucketId,placeKey,value}),
 };
}
// Catalogue places, sent the way the browser sends them.
const place=(key,extra={})=>({key,title:'',place:'',query:'',kind:'',category:'',...extra});
const calls=()=>db.prepare('SELECT provider,kind,count FROM provider_calls ORDER BY kind').all().map(r=>({...r}));

test('without a key or sample provider, places are "not checked" and nothing fails',async()=>{
 const p=person(),r=await p.resolve([place('cafe-soul'),place('ella-stay')]);
 assert.equal(r.status,200);assert.equal(r.body.provider,null);
 assert.deepEqual(r.body.places.map(x=>x.status),['not_checked','not_a_venue']);
 assert.deepEqual(r.body.places.map(x=>x.checkedAt),[null,null],'local classification is not a provider check');
 assert.equal((await p.search('Café Soul')).status,503);assert.equal((await p.details('fixture_cafe_soul')).status,503);
 assert.deepEqual(calls(),[]);
});

test('matches store only the place ID and our own match data; provider coordinates and display details are never stored',async()=>{
 process.env.PLACES_PROVIDER='fixture';
 const p=person(),r=await p.resolve([place('cafe-soul'),place('sunrise'),place('galle-cafes'),place('fitnomads-repeat-villa')]);
 assert.deepEqual(r.body.places.map(x=>[x.status,x.confidence]),[['matched','high'],['possible','low'],['not_a_venue','none'],['unmatched','none']]);
 assert.equal(r.body.places[0].placeId,'fixture_cafe_soul');assert.ok(r.body.places[0].checkedAt>Date.now()-5000);
 assert.ok(r.body.places[1].checkedAt>Date.now()-5000,'possible venues keep their actual lookup time');
 assert.deepEqual(r.body.places.slice(2).map(x=>x.checkedAt),[null,null],'no venue match means no venue verification time');
 const columns=db.prepare('PRAGMA table_info(place_resolutions)').all().map(c=>c.name);
 assert.ok(!columns.some(c=>/name|address|uri|hours|title|^lat$|^lng$|location_expires_at/.test(c)),'no Google content columns: '+columns);
 assert.equal(r.body.places[0].lat,null);assert.equal(r.body.places[0].lng,null);
 assert.deepEqual(calls(),[{provider:'fixture',kind:'search',count:3}],'unnamed venues are never searched; calls are counted');
 await p.resolve([place('cafe-soul')]);
 assert.deepEqual(calls(),[{provider:'fixture',kind:'search',count:3}],'a fresh match is not checked again');
});

test('after 30 days a viewed match is re-checked by ID without saving provider coordinates',async()=>{
 process.env.PLACES_PROVIDER='fixture';
 const p=person();await p.resolve([place('cafe-soul')]);
 db.prepare("UPDATE place_resolutions SET verified_at=? WHERE place_key LIKE 'cafe-soul#%'").run(Date.now()-31*DAY);
 const r=await p.resolve([place('cafe-soul')]);
 assert.ok(r.body.places[0].checkedAt>Date.now()-5000,'last checked moves to now');
 assert.equal(calls().find(c=>c.kind==='details').count,1,'re-checked by id, not searched again');
 assert.equal(r.body.places[0].lat,null,'matching does not return stored coordinates');
 const before=db.prepare("SELECT * FROM place_resolutions WHERE place_key LIKE 'cafe-soul#%'").get();
 const details=await p.details('fixture_cafe_soul');
 assert.equal(details.status,200);assert.equal(typeof details.body.lat,'number');assert.equal(typeof details.body.lng,'number');
 assert.deepEqual(db.prepare("SELECT * FROM place_resolutions WHERE place_key LIKE 'cafe-soul#%'").get(),before,'live map details never change persisted match metadata');
 assert.deepEqual((await p.resolve([place('cafe-soul')])).body.places[0],r.body.places[0]);
 assert.equal(calls().find(c=>c.kind==='details').count,2,'fresh matches do not call the provider; only the explicit details request does');
});

test('the coordinate-removal migration preserves matches, corrections and votes without waiting for a request',()=>{
 const legacy=new DatabaseSync(':memory:');
 try{
  const files=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
  for(const file of files.filter(f=>f<'0006'))legacy.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  legacy.exec("INSERT INTO place_resolutions VALUES ('global','cafe','matched','high','google','ChIJ_cafe_place',6.8,81,1,10,11,NULL),('bucket-a','cafe','matched','confirmed','google','ChIJ_fixed_place',7,82,9999999999999,12,13,'member-a'); INSERT INTO place_votes VALUES ('bucket-a','cafe','member-a',1,14)");
  const columns='scope,place_key,status,confidence,provider,provider_place_id,matched_at,verified_at,fixed_by';
  const expected=legacy.prepare('SELECT '+columns+' FROM place_resolutions ORDER BY scope').all();
  for(const file of files.filter(f=>f>='0006'))legacy.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
  assert.deepEqual(legacy.prepare('SELECT * FROM place_resolutions ORDER BY scope').all(),expected);
  assert.equal(legacy.prepare('SELECT value FROM place_votes').get().value,1);
  assert.ok(!legacy.prepare('PRAGMA table_info(place_resolutions)').all().some(c=>['lat','lng','location_expires_at'].includes(c.name)));
  assert.ok(!legacy.prepare('PRAGMA index_list(place_resolutions)').all().some(i=>i.name==='place_resolutions_expiry_idx'));
 }finally{legacy.close();}
});

test('a provider error or the daily cap leaves places "not checked" instead of failing',async()=>{
 process.env.GOOGLE_PLACES_API_KEY='AIzaTEST_key_0123456789abcdef';
 globalThis.fetch=async()=>new Response('{}',{status:500});
 const p=person(),r=await p.resolve([place('cafe-soul'),place('pool')]);
 assert.equal(r.status,200);assert.deepEqual(r.body.places.map(x=>x.status),['not_checked','not_checked']);
 assert.ok(calls().find(c=>c.provider==='google').count<=2,'only the already in-flight calls can finish after a failure');
 assert.equal((await p.search('Café Soul')).status,503);
 delete process.env.GOOGLE_PLACES_API_KEY;process.env.PLACES_PROVIDER='fixture';
 const q=person(),statuses=[];for(let i=0;i<101;i++)statuses.push((await q.search('Cafe Soul')).status);
 assert.equal(statuses.filter(s=>s===200).length,100);assert.equal(statuses[100],429,'per-visitor daily cap on provider calls');
});

test('a client cannot change the match for a real place by sending a different name',async()=>{
 process.env.PLACES_PROVIDER='fixture';
 const p=person();
 const r=await p.resolve([place('cafe-soul',{title:'Cactus',place:'Colombo',query:'Cactus Colombo',kind:'Named venue'})]);
 assert.equal(r.body.places[0].placeId,'fixture_cafe_soul','the server uses its own copy of the place');
 await p.resolve([place('ai-instagram-made-up-0',{title:'Cactus',place:'Ahangama',query:'Cactus Ahangama',kind:'AI-identified · confirm the name'})]);
 assert.equal(db.prepare("SELECT count(*) AS n FROM place_resolutions WHERE place_key='ai-instagram-made-up-0'").get().n,0,'untrusted input is stored under its own fingerprint');
});

test('shared bucket: a fix applies for everyone, records who fixed it, and keeps the votes',async()=>{
 process.env.PLACES_PROVIDER='fixture';
 const aisha=person(),ben=person(),stranger=person();
 await aisha.name('Aisha');const id=(await aisha.create('Sigiriya',[SIGIRIYA])).body.id;
 await ben.join((await aisha.invite(id)).body.token,'Ben');await stranger.name('Stranger');
 const keys=(await aisha.view(id)).body.reels[0].places.map(x=>x.id);assert.ok(keys.includes('sunrise'));
 const auto=(await ben.resolve(keys.map(k=>place(k)),id)).body.places.find(x=>x.key==='sunrise');
 assert.equal(auto.status,'possible','a low-confidence match waits for a person');
 await aisha.vote(id,'sunrise',1);await ben.vote(id,'sunrise',1);
 assert.equal((await stranger.fix({bucketId:id,key:'sunrise',placeId:'fixture_pidurangala'})).status,404);
 const fixed=await ben.fix({bucketId:id,key:'sunrise',placeId:'fixture_pidurangala'});
 assert.equal(fixed.status,200);assert.deepEqual([fixed.body.status,fixed.body.confidence,fixed.body.fixedBy.name],['matched','confirmed','Ben']);
 const seen=(await aisha.resolve([place('sunrise')],id)).body.places[0];
 assert.deepEqual([seen.placeId,seen.fixedBy.name,seen.fixed],['fixture_pidurangala','Ben',true]);
 const tally=(await aisha.view(id)).body.reels[0].places.find(x=>x.id==='sunrise');assert.equal(tally.up,2,'votes stay with the place across a fix');
 assert.equal((await aisha.resolve([place('sunrise')])).body.places[0].status,'possible','outside the bucket the automatic match is unchanged');
 const notReal=await aisha.fix({bucketId:id,key:'pool',placeId:'x'});assert.equal(notReal.status,400,'only places in this bucket');
 const marked=await aisha.fix({bucketId:id,key:'roys',notAPlace:true});
 assert.equal(marked.body.status,'not_a_place');assert.equal(marked.body.checkedAt,null,'a user correction is not a venue check');
 assert.equal((await aisha.fix({bucketId:id,key:'roys',reset:true})).body.status,'matched','a fix can be undone');
 assert.equal((await ben.fix({bucketId:id,key:'sunrise',placeId:'fixture_not_a_real_one'})).status,404);
 // A week-2 snapshot without kinds still never looks up an unnamed venue.
 db.prepare("UPDATE bucket_reels SET analysis=json_set(analysis,'$.places',(SELECT json_group_array(json_remove(value,'$.kind','$.query')) FROM json_each(analysis,'$.places')))").run();
 const safari=(await aisha.resolve([place('safari')],id)).body.places[0];assert.equal(safari.status,'not_a_venue');
});

test('live details are returned to the viewer and never written to the database',async()=>{
 process.env.PLACES_PROVIDER='fixture';
 const p=person(),r=await p.details('fixture_cafe_soul');
 assert.equal(r.status,200);assert.equal(r.body.name,'Café Soul');assert.equal(r.body.provider,'fixture');
 assert.equal(db.prepare('SELECT count(*) AS n FROM place_resolutions').get().n,0);
 assert.equal((await p.details('../../etc')).status,400);
});
