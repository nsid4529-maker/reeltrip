import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1,withProcessor} from './helpers/route-harness.mjs';
const {snapshot,removeReel}=await import('../lib/server/shared-buckets.ts');
const {reelID}=await import('../lib/reel-library.ts');
const shared=await import('../app/api/shared/route.ts'),buckets=await import('../app/api/shared/bucket/route.ts'),reels=await import('../app/api/shared/reels/route.ts'),members=await import('../app/api/members/route.ts'),votes=await import('../app/api/shared/votes/route.ts'),fixes=await import('../app/api/places/fix/route.ts');
const schema=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const url='https://www.instagram.com/reel/RefreshRace1/',workerId='00000000-0000-4000-8000-0000000000c4';
const source={id:'ai-race',source_url:url,platform:'Instagram',analysis_kind:'ai',creator:'Creator',scope:'Kyoto',title:'Kyoto places',days:[],unknowns:[]};
const place={id:'ai-race-1',source:source.id,title:'Temple',place:'Kyoto',category:'Experiences',quote:'Temple',second:2,kind:'Named',query:'Temple Kyoto'};
const analysis=(p=place)=>({source,matches:[p]});
let db,binding,restore,headers,handler;
beforeEach(()=>{({db,binding}=d1(schema));headers={'cf-connecting-ip':'198.51.100.94'};handler=async()=>Response.json({id:workerId,status:'queued',stage:'queued'});restore=withProcessor((...args)=>handler(...args));});
afterEach(()=>restore());
async function call(route,method,path,body){
 const r=await route(new Request('https://reeltrip.test'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const c=r.headers.get('set-cookie');if(c)headers.cookie=c.split(';')[0];
 return {status:r.status,body:await r.json()};
}
const view=id=>call(buckets.GET,'GET','/api/shared/bucket?id='+id);
const refresh=id=>call(reels.POST,'POST','/api/shared/reels',{bucketId:id,url,refresh:true});
async function saved(){
 await call(members.POST,'POST','/api/members',{name:'Mei'});
 const {body}=await call(shared.POST,'POST','/api/shared',{name:'Kyoto'}),id=body.id,me=(await view(id)).body.me,reelId=crypto.randomUUID();
 db.prepare('INSERT INTO bucket_reels(id,bucket_id,source_key,source_url,added_by,added_at,status,analysis,checked_at) VALUES(?,?,?,?,?,?,?,?,?)').run(reelId,id,reelID(url),url,me.id,Date.now(),'ready',JSON.stringify(snapshot({status:'analysis_completed',...analysis()})),0);
 return {id,reelId,me};
}
function deferResponses(count){
 const pending=[];let ready;const started=new Promise(resolve=>{ready=resolve;});
 handler=()=>new Promise(resolve=>{pending.push(resolve);if(pending.length===count)ready();});
 return {pending,started};
}
const completed=()=>Response.json({id:workerId,status:'complete',result:analysis({...place,title:'Cafe',quote:'Cafe',category:'Food'})});
async function voteAndFix(id,key){
 assert.equal((await call(votes.POST,'POST','/api/shared/votes',{bucketId:id,placeKey:key,value:1})).status,200);
 assert.equal((await call(fixes.POST,'POST','/api/places/fix',{bucketId:id,key,notAPlace:true})).status,200);
}
async function assertRetained(id,key){
 const reel=(await view(id)).body.reels[0];assert.equal(reel.places[0].id,key);assert.equal(reel.places[0].myVote,1);
 assert.equal(db.prepare('SELECT count(*) n FROM place_resolutions WHERE scope=? AND place_key=?').get(id,key).n,1);
}
test('a late poll after its expired lease cannot replace newer place ids, votes or fixes',{timeout:3000},async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {id}=await saved();await refresh(id);db.prepare('UPDATE bucket_reels SET checked_at=0').run();
 const {pending,started}=deferResponses(1),first=view(id);await started;
 now+=41000;const second=view(id);while(pending.length<2)await new Promise(resolve=>setImmediate(resolve));
 pending[1](completed());const winner=await second,key=winner.body.reels[0].places[0].id;await voteAndFix(id,key);
 pending[0](completed());await first;await assertRetained(id,key);
});
test('simultaneous viewers share one processor poll and its quota charge',{timeout:3000},async()=>{
 const {id}=await saved();await refresh(id);db.prepare('UPDATE bucket_reels SET checked_at=0').run();
 const {pending,started}=deferResponses(1),first=view(id);await started;
 const other=await view(id);assert.equal(other.body.reels[0].status,'analysing');assert.equal(pending.length,1);
 pending[0](completed());assert.equal((await first).body.reels[0].status,'ready');
});
test('faster refresh keeps the old four polls per twenty seconds bucket ceiling and checks oldest jobs',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {id,reelId,me}=await saved();await refresh(id);
 const {job_id:job}=db.prepare('SELECT job_id FROM bucket_reels WHERE id=?').get(reelId);
 for(let i=1;i<=3;i++)db.prepare('INSERT INTO bucket_reels(id,bucket_id,source_key,source_url,added_by,added_at,status,job_id,checked_at) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,'instagram-Poll'+i,url+i,me.id,now,'analysing',job,0);
 db.prepare('UPDATE bucket_reels SET checked_at=0').run();let polls=0;
 handler=async()=>{polls++;return Response.json({id:workerId,status:'queued',stage:'queued'});};
 for(let i=0;i<20;i++){await view(id);now+=1000;}
 assert.equal(polls,4);assert.equal(db.prepare('SELECT count(*) n FROM bucket_reels WHERE checked_at>0').get().n,4);
});
test('concurrent explicit refresh submissions cannot overwrite a newer saved analysis',{timeout:3000},async()=>{
 const {id}=await saved(),{pending,started}=deferResponses(2),first=refresh(id),second=refresh(id);await started;
 pending[0](completed());await Promise.race([first,second]);const key=(await view(id)).body.reels[0].places[0].id;await voteAndFix(id,key);
 pending[1](completed());await Promise.all([first,second]);await assertRetained(id,key);
});
test('place cleanup keeps votes and fixes if another reel starts referencing it before deletion',async()=>{
 const {id,reelId,me}=await saved();await voteAndFix(id,place.id);let inserted=false;
 const guarded={prepare(sql){return {bind(...values){const statement=binding.prepare(sql).bind(...values);if(sql.startsWith('DELETE FROM place_votes'))return {...statement,run:async()=>{
  if(!inserted){inserted=true;db.prepare('INSERT INTO bucket_reels(id,bucket_id,source_key,source_url,added_by,added_at,status,analysis,checked_at) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,'instagram-NewReference','https://www.instagram.com/reel/NewReference/',me.id,Date.now(),'ready',JSON.stringify(snapshot({status:'analysis_completed',...analysis()})),0);}
  return statement.run();
 }};return statement;}};}};
 await removeReel(guarded,me,id,reelId);await assertRetained(id,place.id);
});
