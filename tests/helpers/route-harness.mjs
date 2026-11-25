// Loads a real API route with a SQLite-backed D1 stand-in and the project's
// "@/" alias, so route behaviour is tested without a Worker runtime.
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const workerEnv={};globalThis.__reeltripRouteTestEnv=workerEnv;
registerHooks({
 resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__reeltripRouteTestEnv;',shortCircuit:true};
  if(specifier.startsWith('@/'))specifier=pathToFileURL(path.join(root,specifier.slice(2))).href;
  try{return next(specifier,context);}
  catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&(specifier.startsWith('.')||specifier.startsWith('file:')))return next(specifier+'.ts',context);throw error;}
 },
 load(url,context,next){
  // Bundlers allow bare JSON imports; Node needs an import attribute.
  if(url.endsWith('.json')&&url.startsWith('file:'))return {format:'module',source:'export default '+readFileSync(fileURLToPath(url),'utf8'),shortCircuit:true};
  return next(url,context);
 },
});

export function d1(schema){
 const db=new DatabaseSync(':memory:');db.exec(schema);const sql=[];
 const binding={prepare(query){const bound=(...args)=>{const statement=db.prepare(query);return {first:async()=>{sql.push(query);return statement.get(...args)??null;},all:async()=>{sql.push(query);return {results:statement.all(...args)};},run:async()=>{sql.push(query);return statement.run(...args);}};};return {bind:bound,...bound()};},batch:async statements=>Promise.all(statements.map(statement=>statement.run()))};
 workerEnv.DB=binding;
 return {db,sql,binding};
}
export const CORE_SCHEMA='CREATE TABLE analysis_cache(key TEXT PRIMARY KEY,source_url TEXT NOT NULL,result TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE processing_jobs(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,source_url TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE usage_counters(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);';

export function withProcessor(fetcher){
 const saved={fetch:globalThis.fetch,url:process.env.REELTRIP_PROCESSOR_URL,token:process.env.REELTRIP_PROCESSOR_TOKEN};
 process.env.REELTRIP_PROCESSOR_URL='https://processor.example';process.env.REELTRIP_PROCESSOR_TOKEN='test-only-token-that-is-long-enough-1234';
 globalThis.fetch=fetcher;
 return ()=>{globalThis.fetch=saved.fetch;for(const [key,value] of [['REELTRIP_PROCESSOR_URL',saved.url],['REELTRIP_PROCESSOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
}
