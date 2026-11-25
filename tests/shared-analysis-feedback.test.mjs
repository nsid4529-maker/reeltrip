import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1,withProcessor} from './helpers/route-harness.mjs';
const {snapshot}=await import('../lib/server/shared-buckets.ts');
const {reelID}=await import('../lib/reel-library.ts');
const shared=await import('../app/api/shared/route.ts'),buckets=await import('../app/api/shared/bucket/route.ts'),reels=await import('../app/api/shared/reels/route.ts'),members=await import('../app/api/members/route.ts'),votes=await import('../app/api/shared/votes/route.ts');
const resolvePlaces=await import('../app/api/places/resolve/route.ts'),fixPlace=await import('../app/api/places/fix/route.ts');
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const url='https://www.instagram.com/reel/FeedbackReel1/',workerId='00000000-0000-4000-8000-0000000000c3';
const source={id:'ai-feedback',source_url:url,platform:'Instagram',analysis_kind:'ai',creator:'Example creator',scope:'Kyoto',title:'Kyoto places',days:[],unknowns:[]};
const place={id:'ai-feedback-1',source:source.id,title:'Temple',place:'Kyoto',category:'Experiences',quote:'Temple',second:2,kind:'Named',query:'Temple Kyoto'};
const analysis=(matches=[place],unknowns=[])=>({source:{...source,unknowns},matches});
let db,restore,headers,phase,requests;
beforeEach(()=>{
 ({db}=d1(migrations));headers={'cf-connecting-ip':'198.51.100.91'};phase={id:workerId,status:'queued',stage:'queued'};requests=[];
 restore=withProcessor(async(url,options)=>{requests.push(options.method);return Response.json(phase);});
});
afterEach(()=>restore());
async function call(handler,method,path,body,requestHeaders=headers){
 const response=await handler(new Request('https://reeltrip.test'+path,{method,headers:requestHeaders,...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const cookie=response.headers.get('set-cookie');if(cookie)requestHeaders.cookie=cookie.split(';')[0];
 return {status:response.status,body:await response.json()};
}
async function saved(result=analysis()){
 await call(members.POST,'POST','/api/members',{name:'Mei'});
 const created=await call(shared.POST,'POST','/api/shared',{name:'Kyoto'}),id=created.body.id;
 const {body}=await view(id),reelId=crypto.randomUUID();
 db.prepare('INSERT INTO bucket_reels (id,bucket_id,source_key,source_url,added_by,added_at,status,analysis,checked_at) VALUES (?,?,?,?,?,?,?,?,?)').run(reelId,id,reelID(url),url,body.me.id,Date.now(),'ready',JSON.stringify(snapshot({status:'analysis_completed',...result})),0);
 return {id,reelId};
}
const view=id=>call(buckets.GET,'GET','/api/shared/bucket?id='+id);
const refresh=id=>call(reels.POST,'POST','/api/shared/reels',{bucketId:id,url,refresh:true});
const expirePoll=()=>db.prepare('UPDATE bucket_reels SET checked_at=0').run();

test('shared snapshots preserve omission counts without exposing diagnostics or doubling repeated warnings',async()=>{
 const warnings=['Partial breakdown: 7 detail(s) could not be verified against source evidence after a correction attempt and were excluded.','Partial breakdown: 7 detail(s) were excluded.','Dates not given',null];
 const {id}=await saved(analysis([],warnings));
 const reel=(await view(id)).body.reels[0];
 assert.equal(reel.omittedDetails,7);assert.equal(reel.places.length,0);assert.equal(reel.status,'ready');
 assert.equal(reel.creator,source.creator);assert.equal(reel.url,url);
 assert.doesNotMatch(JSON.stringify(reel),/correction attempt|unknowns/);
 const original=snapshot({status:'analysis_completed',...analysis()});assert.equal(original.omittedDetails,undefined,'ordinary unknowns are not omitted-place counts');
 db.prepare('UPDATE bucket_reels SET analysis=?').run(JSON.stringify({...original,omittedDetails:-3}));
 assert.equal((await view(id)).body.reels[0].omittedDetails,0,'legacy or malformed omission counts do not produce warnings');
});

test('ready reels refresh only by explicit member action and keep saved places while pending',async()=>{
 const {id}=await saved();
 assert.equal((await call(reels.POST,'POST','/api/shared/reels',{bucketId:id,url})).status,200);
 assert.equal(requests.length,0,'a duplicate paste does not spend another analysis request');
 assert.equal((await call(reels.POST,'POST','/api/shared/reels',{bucketId:id,url,refresh:true},{'cf-connecting-ip':'198.51.100.92'})).status,401);
 assert.equal((await refresh(id)).status,200);
 let reel=(await view(id)).body.reels[0];
 assert.equal(reel.status,'analysing');assert.equal(reel.places[0].title,'Temple');assert.match(reel.message,/saved places are still shown/);
 assert.equal((await call(votes.POST,'POST','/api/shared/votes',{bucketId:id,placeKey:place.id,value:1})).status,200,'preserved places remain usable while refreshing');
 assert.equal((await call(resolvePlaces.POST,'POST','/api/places/resolve',{bucketId:id,places:[{...place,key:place.id}]})).status,200);
 assert.equal((await call(fixPlace.POST,'POST','/api/places/fix',{bucketId:id,key:place.id,notAPlace:true})).status,200);
 await refresh(id);assert.deepEqual(requests,['POST'],'refresh cannot duplicate a running job');
 phase={id:workerId,status:'processing',stage:'analysing'};expirePoll();
 reel=(await view(id)).body.reels[0];assert.equal(reel.status,'analysing');assert.equal(reel.places[0].title,'Temple');
});

test('a failed or empty refresh retains saved places and votes with an honest notice',async()=>{
 for(const terminal of [{id:workerId,status:'failed',error:{code:'analysis_invalid',message:'private diagnostic'}},{id:workerId,status:'complete',result:analysis([],['Partial breakdown: 7 detail(s) were excluded.'])}]){
  const {id}=await saved();
  await call(votes.POST,'POST','/api/shared/votes',{bucketId:id,placeKey:place.id,value:1});
  // This represents the normal new-version cache miss, never a production quota bypass.
  db.prepare('DELETE FROM analysis_cache').run();db.prepare('DELETE FROM processing_jobs').run();
  phase={id:workerId,status:'queued',stage:'queued'};await refresh(id);phase=terminal;expirePoll();
  const reel=(await view(id)).body.reels[0];
  assert.equal(reel.status,'ready');assert.equal(reel.places[0].title,'Temple');assert.equal(reel.places[0].myVote,1);
  assert.match(reel.message,/previous places are still shown|saved places are still shown/);assert.doesNotMatch(reel.message,/private diagnostic/);
 }
});

test('a refreshed result cannot move votes or place fixes onto a different positional item',async()=>{
 const {id}=await saved();await call(votes.POST,'POST','/api/shared/votes',{bucketId:id,placeKey:place.id,value:1});
 await refresh(id);
 phase={id:workerId,status:'complete',result:analysis([{...place,title:'Cafe',category:'Food',quote:'Cafe'}, {...place,id:'ai-feedback-2'}])};expirePoll();
 const reel=(await view(id)).body.reels[0],cafe=reel.places.find(p=>p.title==='Cafe'),temple=reel.places.find(p=>p.title==='Temple');
 assert.equal(reel.status,'ready');assert.equal(temple.id,place.id);assert.equal(temple.myVote,1);
 assert.notEqual(cafe.id,place.id);assert.equal(cafe.myVote,0);assert.equal(new Set(reel.places.map(p=>p.id)).size,2);
});

test('a legacy empty result can refresh and an explicit non-travel result withholds old recommendations',async()=>{
 const empty=await saved(analysis([]));await refresh(empty.id);
 phase={id:workerId,status:'complete',result:analysis()};expirePoll();
 assert.equal((await view(empty.id)).body.reels[0].places.length,1);
 db.prepare('DELETE FROM analysis_cache').run();db.prepare('DELETE FROM processing_jobs').run();
 phase={id:workerId,status:'complete',result:{not_travel:true}};await refresh(empty.id);
 const reel=(await view(empty.id)).body.reels[0];assert.equal(reel.status,'not_travel');assert.equal(reel.places.length,0);
});

test('refresh clears votes and fixes for superseded places while preserving unchanged ones',async()=>{
 const old={...place,id:'ai-feedback-2',title:'Shrine',quote:'Shrine'}, {id}=await saved(analysis([place,old]));
 for(const p of [place,old]){
  await call(votes.POST,'POST','/api/shared/votes',{bucketId:id,placeKey:p.id,value:1});
  await call(fixPlace.POST,'POST','/api/places/fix',{bucketId:id,key:p.id,notAPlace:true});
 }
 await refresh(id);phase={id:workerId,status:'complete',result:analysis()};expirePoll();await view(id);
 assert.deepEqual(db.prepare('SELECT place_key FROM place_votes WHERE bucket_id=?').all(id).map(p=>p.place_key),[place.id]);
 assert.deepEqual(db.prepare('SELECT place_key FROM place_resolutions WHERE scope=?').all(id).map(p=>p.place_key),[place.id]);
});

test('removing a reel during refresh removes its saved votes and bucket venue fixes',async()=>{
 const {id,reelId}=await saved();
 await call(votes.POST,'POST','/api/shared/votes',{bucketId:id,placeKey:place.id,value:1});
 await call(fixPlace.POST,'POST','/api/places/fix',{bucketId:id,key:place.id,notAPlace:true});
 await refresh(id);
 assert.equal((await call(reels.DELETE,'DELETE','/api/shared/reels',{bucketId:id,reelId})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM place_votes WHERE bucket_id=?').get(id).n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM place_resolutions WHERE scope=?').get(id).n,0);
});
