import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

// Run the real gateway with SQLite and a test-only Cloudflare binding.
const workerEnv={};globalThis.__reeltripProcessingTestEnv=workerEnv;
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__reeltripProcessingTestEnv;',shortCircuit:true};
 try{return next(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.'))return next(specifier+'.ts',context);throw error;}
}});
const {startAnalysis,cachedAnalysis}=await import('../lib/server/processing.ts');
hooks.deregister();delete globalThis.__reeltripProcessingTestEnv;
const revision='2026-11-24-grounded-retry-v13',workerId='00000000-0000-4000-8000-000000000001';
const originalFetch=globalThis.fetch,originalURL=process.env.REELTRIP_PROCESSOR_URL,originalToken=process.env.REELTRIP_PROCESSOR_TOKEN;
let db,calls,sql;
const request=()=>new Request('https://reeltrip.test/api/extract',{headers:{'cf-connecting-ip':'203.0.113.1'}});
function seed(key,sourceURL,{expires=Date.now()+60000,cacheVersion=revision,analysisURL=sourceURL}={}){
 const analysis={source:{id:key,source_url:analysisURL,title:'Source-specific highlights'},matches:[],cacheVersion};
 db.prepare('INSERT INTO analysis_cache VALUES (?,?,?,?)').run(key,sourceURL,JSON.stringify(analysis),expires);return analysis;
}
function counters(){return db.prepare('SELECT count(*) AS total FROM usage_counters').get().total;}

beforeEach(()=>{
 db=new DatabaseSync(':memory:');calls=[];sql=[];
 db.exec('CREATE TABLE analysis_cache(key TEXT PRIMARY KEY,source_url TEXT NOT NULL,result TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE processing_jobs(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,source_url TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE usage_counters(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
 workerEnv.DB={prepare(query){return {bind(...args){const statement=db.prepare(query);return {first:async()=>{sql.push(query);return statement.get(...args)??null;},all:async()=>{sql.push(query);return {results:statement.all(...args)};},run:async()=>{sql.push(query);return statement.run(...args);}};}};},batch:async statements=>Promise.all(statements.map(statement=>statement.run()))};
 process.env.REELTRIP_PROCESSOR_URL='https://processor.example';process.env.REELTRIP_PROCESSOR_TOKEN='test-only-token';
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:workerId,status:'queued',stage:'queued'});};
});
afterEach(()=>{
 db.close();globalThis.fetch=originalFetch;
 if(originalURL===undefined)delete process.env.REELTRIP_PROCESSOR_URL;else process.env.REELTRIP_PROCESSOR_URL=originalURL;
 if(originalToken===undefined)delete process.env.REELTRIP_PROCESSOR_TOKEN;else process.env.REELTRIP_PROCESSOR_TOKEN=originalToken;
});

test('Instagram and TikTok aliases reuse the canonical cache without worker calls or analysis quota',async t=>{
 const instagram=seed('ai-instagram-example','https://www.instagram.com/reel/example/');
 const tiktok=seed('ai-tiktok-1234567890123','https://www.tiktok.com/@creator/video/1234567890123/');
 const aliases=[['https://instagram.com/p/example',instagram],['https://www.instagram.com/reels/example/',instagram],['https://m.tiktok.com/@creator/video/1234567890123',tiktok]];
 for(const [alias,expected] of aliases){
  assert.equal(db.prepare('SELECT result FROM analysis_cache WHERE source_url=?').get(alias),undefined,'the previous exact URL lookup misses this alias');
  const before=sql.length,result=await startAnalysis(request(),alias);
  assert.equal(result.status,'analysis_completed');assert.deepEqual(result.source,expected.source);assert.equal(sql.length-before,1,'only the primary-key cache read is needed');
 }
 assert.equal(calls.length,0);assert.equal(counters(),0);assert.equal(db.prepare('SELECT count(*) AS total FROM processing_jobs').get().total,0);
 t.diagnostic('Before: exact-URL lookup missed all 3 aliases. After: 3 canonical cache reads, 0 worker calls, 0 quota reservations, 0 new job mappings.');
 t.diagnostic('Canonical read plan: '+db.prepare('EXPLAIN QUERY PLAN '+sql[0]).all('ai-instagram-example',Date.now(),revision).map(row=>row.detail).join('; '));
});

test('expired, old-revision and different-source analyses cannot bypass fresh analysis',async()=>{
 seed('ai-instagram-expired','https://www.instagram.com/reel/expired/',{expires:Date.now()-1000});
 seed('ai-instagram-old','https://www.instagram.com/reel/old/',{cacheVersion:'older-pipeline'});
 seed('ai-instagram-other','https://www.instagram.com/reel/other/');
 // The processor gives each distinct URL its own job.
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:'00000000-0000-4000-8000-00000000000'+calls.length,status:'queued',stage:'queued'});};
 for(const id of ['expired','old','new']){
  const result=await startAnalysis(request(),'https://www.instagram.com/p/'+id+'/');assert.equal(result.status,'queued');assert.ok(result.jobId);
 }
 assert.equal(calls.length,3);assert.deepEqual(calls.map(call=>JSON.parse(call.options.body).url),['expired','old','new'].map(id=>'https://www.instagram.com/p/'+id+'/'));
 const counts=db.prepare('SELECT count FROM usage_counters').all();assert.equal(counts.length,2);assert.ok(counts.every(row=>row.count===3));
});

test('an old completed job mapping cannot bypass the new pipeline revision',async()=>{
 const url='https://www.instagram.com/reel/example/',publicId='11111111-1111-4111-8111-111111111111';
 seed('ai-instagram-example',url,{cacheVersion:'2026-11-19-detail-v8'});
 db.prepare('INSERT INTO processing_jobs VALUES (?,?,?,?)').run(publicId,workerId,url,Date.now()+60000);
 const source={id:'worker-source',source_url:url,platform:'Instagram',analysis_kind:'ai',title:'Partial previous result',creator:'creator',scope:'Travel',days:[],unknowns:['A named place was omitted.']};
 globalThis.fetch=async(endpoint,options)=>{calls.push({url:endpoint,options});return Response.json(options.method==='GET'
  ?{id:workerId,status:'complete',stage:'complete',result:{source,matches:[],pipeline_version:'2026-11-19-detail-v8'}}
  :{id:'00000000-0000-4000-8000-000000000002',status:'queued',stage:'queued'});};
 const result=await startAnalysis(request(),url);
 assert.equal(result.status,'queued');assert.notEqual(result.jobId,publicId);
 assert.deepEqual(calls.map(call=>call.options.method),['GET','POST']);
 assert.equal(db.prepare('SELECT count(*) AS n FROM processing_jobs').get().n,2,'old jobs are preserved, not deleted');
 assert.equal(JSON.parse(db.prepare('SELECT result FROM analysis_cache WHERE key=?').get('ai-instagram-example').result).cacheVersion,'2026-11-19-detail-v8');
});

test('a current completed job mapping remains reusable without a new analysis charge',async()=>{
 const url='https://www.instagram.com/reel/example/',publicId='11111111-1111-4111-8111-111111111111';
 db.prepare('INSERT INTO processing_jobs VALUES (?,?,?,?)').run(publicId,workerId,url,Date.now()+60000);
 const source={id:'worker-source',source_url:url,platform:'Instagram',analysis_kind:'ai',title:'Current result',creator:'creator',scope:'Travel',days:[],unknowns:[]};
 globalThis.fetch=async(endpoint,options)=>{calls.push({url:endpoint,options});return Response.json({id:workerId,status:'complete',stage:'complete',result:{source,matches:[],pipeline_version:revision}});};
 const result=await startAnalysis(request(),url);
 assert.equal(result.status,'analysis_completed');assert.equal(result.jobId,publicId);assert.equal(calls.length,1);
 assert.ok(db.prepare('SELECT key FROM usage_counters').all().every(row=>row.key.startsWith('poll:')));
 assert.equal((await cachedAnalysis('ai-instagram-example')).cacheVersion,revision);
});

test('verified vm/vt TikTok short links keep exact-URL fallback and distinct tokens stay distinct',async()=>{
 for(const host of ['vm','vt']){
  const url='https://'+host+'.tiktok.com/'+host+'Example/',id=host==='vm'?'1234567890123':'9876543210123',analysisURL='https://www.tiktok.com/@creator/video/'+id+'/';seed('ai-tiktok-'+id,url,{analysisURL});
  const result=await startAnalysis(request(),url);assert.equal(result.status,'analysis_completed');assert.equal(result.source.source_url,analysisURL);
 }
 assert.equal(calls.length,0);assert.equal(counters(),0);
 const different=await startAnalysis(request(),'https://vm.tiktok.com/Different/');assert.equal(different.status,'queued');assert.equal(calls.length,1);
});

test('cache reuse retains the existing service configuration gate',async()=>{
 seed('ai-instagram-example','https://www.instagram.com/reel/example/');delete process.env.REELTRIP_PROCESSOR_TOKEN;
 assert.equal((await startAnalysis(request(),'https://www.instagram.com/p/example/')).status,'service_unavailable');assert.equal(sql.length,0);assert.equal(calls.length,0);assert.equal(counters(),0);
});


test('uploaded breakdown cache reads require the signed owner and never consult the public D1 cache',async()=>{
 const {uploadOwner}=await import('../lib/server/upload-owner.ts');
 process.env.REELTRIP_PROCESSOR_TOKEN='private-upload-cache-signing-secret-longer-than-32';
 const uploadId='33333333-3333-4333-8333-333333333333',sourceId='ai-upload-'+uploadId;
 seed(sourceId,'/api/upload?id='+uploadId);
 assert.equal(await cachedAnalysis(sourceId),null);
 assert.equal(await cachedAnalysis(sourceId,request()),null);
 assert.equal(sql.length,0);assert.equal(calls.length,0);
 const identity=await uploadOwner(request(),process.env.REELTRIP_PROCESSOR_TOKEN,true);
 const owned=new Request('https://reeltrip.test/api/bundle-chat',{headers:{cookie:identity.cookie.split(';')[0]}});
 globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.equal(options.headers['X-Upload-Owner'],identity.owner);return Response.json({id:workerId,uploadId,status:'complete',stage:'complete',result:{source:{id:sourceId,source_url:'/api/upload?id='+uploadId,platform:'Uploaded video',analysis_kind:'ai',creator:'Your upload',scope:'Uploaded travel video',title:'Travel plans',days:[],unknowns:[]},matches:[]}});};
 const analysis=await cachedAnalysis(sourceId,owned);assert.equal(analysis.source.id,sourceId);
 assert.equal(calls.length,1);assert.ok(sql.every(query=>!query.includes('FROM analysis_cache')));
 globalThis.fetch=async()=>Response.json({error:{code:'upload_not_found'}},{status:404});
 assert.equal(await cachedAnalysis(sourceId,owned),null,'another owner cannot use a guessed analysis id');
});
