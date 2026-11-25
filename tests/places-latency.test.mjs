import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1} from './helpers/route-harness.mjs';
const {resolvePlaces}=await import('../lib/server/places/service.ts');
const {ProviderError}=await import('../lib/server/places/provider.ts');
const {ServiceError}=await import('../lib/server/http-safety.ts');
const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8').replaceAll('--> statement-breakpoint','')).join('\n');
const place=n=>({key:n,title:'Cafe '+n,place:'Kyoto',query:n,kind:'Named venue'});
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));for(let i=0;i<40;i++)await Promise.resolve();};

test('independent venues resolve three at a time, preserve input order and charge before requests',{timeout:2000},async()=>{
 const {binding}=d1(migrations),pending=new Map(),started=[],waiters=new Map();let charges=0,active=0,peak=0;
 const reached=n=>started.length>=n?Promise.resolve():new Promise(resolve=>waiters.set(n,resolve));
 const provider={name:'fixture',details:async()=>null,search:async query=>{assert.ok(charges>started.length);started.push(query);peak=Math.max(peak,++active);await new Promise(resolve=>{pending.set(query,resolve);waiters.get(started.length)?.();});active--;return [];}};
 const inputs=['Alpha','Beta','Gamma','Delta','Epsilon'].map(place);
 const result=resolvePlaces(binding,provider,async()=>{charges++;},inputs,null);
 await reached(3);assert.equal(started.length,3);assert.equal(active,3);
 pending.get('Beta')();await reached(4);
 assert.ok(started.includes('Delta'),'one finished lookup releases a worker without waiting for the first');
 for(const finish of pending.values())finish();await reached(5);
 assert.equal(started.length,5);for(const finish of pending.values())finish();
 const views=await result;
 assert.deepEqual(views.map(v=>v.key),inputs.map(i=>i.key));assert.equal(peak,3);assert.equal(charges,5);
});

test('a failed lookup stops new provider work while preserving results already in flight',{timeout:2000},async()=>{
 const {binding}=d1(migrations),pending=[];let charges=0,started;
 const threeStarted=new Promise(resolve=>{started=resolve;});
 const provider={name:'fixture',details:async()=>null,search:()=>new Promise((resolve,reject)=>{pending.push({resolve,reject});if(pending.length===3)started();})};
 const result=resolvePlaces(binding,provider,async()=>{charges++;},Array.from({length:8},(_,i)=>place('venue'+i)),null);
 await threeStarted;assert.equal(pending.length,3);
 pending[0].reject(new ProviderError('busy'));await settle();
 pending.slice(1).forEach(p=>p.resolve([]));const views=await result;
 assert.equal(charges,3);assert.equal(pending.length,3);assert.equal(views.length,8);
 assert.equal(views.filter(v=>v.status==='not_checked').length,6);
});

test('concurrent lookups never call the provider without available quota',async()=>{
 const {binding}=d1(migrations);let credits=1,requests=0;
 const provider={name:'fixture',search:async()=>{requests++;return [];},details:async()=>null};
 const charge=async()=>{if(!credits)throw new ServiceError('Daily limit',429);credits--;};
 const result=await resolvePlaces(binding,provider,charge,Array.from({length:8},(_,i)=>place('limited'+i)),null);
 assert.equal(requests,1);assert.equal(credits,0);assert.equal(result.length,8);
 assert.equal(result.filter(v=>v.status==='not_checked').length,7);
});

test('duplicate keys reuse their match and invalid batches cause no provider calls',async()=>{
 const {binding}=d1(migrations);let charges=0;
 const provider={name:'fixture',search:async()=>[],details:async()=>null},input=place('duplicate');
 const result=await resolvePlaces(binding,provider,async()=>{charges++;},[input,input],null);
 assert.equal(charges,1);assert.equal(result.length,2);assert.deepEqual(result[0],result[1]);
 await assert.rejects(resolvePlaces(binding,provider,async()=>{charges++;},[input,{}],null),/Invalid place/);
 assert.equal(charges,1);
});

test('a trusted analysis rename ignores a legacy cached miss and never inherits the old venue',async()=>{
 const {binding,db}=d1(migrations),key='ai-instagram-cache-0';let searches=0;
 const save=title=>db.prepare('INSERT INTO analysis_cache(key,source_url,result,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET result=excluded.result').run('ai-instagram-cache','https://www.instagram.com/reel/cache/',JSON.stringify({matches:[{id:key,title,place:'Kyoto',query:title,kind:'Named venue'}]}),Date.now()+86400000);
 const provider={name:'fixture',details:async()=>null,search:async title=>{searches++;return [{id:'fixture_'+title,name:title,address:'Kyoto',lat:null,lng:null}];}};
 db.prepare("INSERT INTO place_resolutions(scope,place_key,status,confidence,provider,provider_place_id,matched_at,verified_at,fixed_by) VALUES('global',?,'unmatched','none','fixture',NULL,?,?,NULL)").run(key,Date.now(),Date.now());
 save('Alpha');const first=(await resolvePlaces(binding,provider,async()=>{},[{key,title:'Client tampering',place:'Elsewhere'}],null))[0];
 assert.equal(first.placeId,'fixture_Alpha','legacy positional miss cannot block the current trusted name');
 save('Beta');const second=(await resolvePlaces(binding,provider,async()=>{},[{key,title:'Alpha',place:'Kyoto'}],null))[0];
 assert.equal(second.placeId,'fixture_Beta','the same analysis position must not retain Alpha');
 await resolvePlaces(binding,provider,async()=>{},[{key,title:'anything',place:''}],null);
 assert.equal(searches,2,'identical trusted input still reuses its fresh lookup');
 assert.equal(first.key,key);assert.equal(second.key,key,'public IDs remain stable for votes and fixes');
});

test('reordered trusted analysis positions use the corresponding venue, not another position’s cached match',async()=>{
 const {binding,db}=d1(migrations);let searches=0;
 const keys=['ai-tiktok-reorder-0','ai-tiktok-reorder-1'];
 const save=names=>db.prepare('INSERT INTO analysis_cache(key,source_url,result,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET result=excluded.result').run('ai-tiktok-reorder','https://www.tiktok.com/@example/video/123/',JSON.stringify({matches:names.map((title,i)=>({id:keys[i],title,place:'Kyoto',query:title,kind:'Named venue'}))}),Date.now()+86400000);
 const provider={name:'fixture',details:async()=>null,search:async title=>{searches++;return [{id:'fixture_'+title,name:title,address:'Kyoto',lat:null,lng:null}];}};
 const inputs=keys.map(key=>({key,title:'',place:''}));
 save(['Alpha','Beta']);assert.deepEqual((await resolvePlaces(binding,provider,async()=>{},inputs,null)).map(p=>p.placeId),['fixture_Alpha','fixture_Beta']);
 save(['Beta','Alpha']);assert.deepEqual((await resolvePlaces(binding,provider,async()=>{},inputs,null)).map(p=>p.placeId),['fixture_Beta','fixture_Alpha']);
 await resolvePlaces(binding,provider,async()=>{},inputs,null);assert.equal(searches,4);
});
