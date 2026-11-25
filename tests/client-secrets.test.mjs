import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import path from 'node:path';

// Browser code must never reach server modules or read server secrets. The
// built-bundle check is scripts/check-client-secrets.mjs (run after a build).
const root=path.resolve(import.meta.dirname,'..');
const files=[];for(const dir of ['app','components','lib','hooks'])(function walk(d){for(const n of readdirSync(d)){const f=path.join(d,n);if(statSync(f).isDirectory()){if(n!=='server'&&n!=='api')walk(f);}else if(/\.tsx?$/.test(n))files.push(f);}})(path.join(root,dir));
test('no browser-side file imports server code or names a server secret',()=>{
 const client=files.filter(f=>/^\s*['"]use client['"]/.test(readFileSync(f,'utf8')));
 assert.ok(client.length>20,'found the client components');
 for(const file of client){
  const text=readFileSync(file,'utf8');
  assert.doesNotMatch(text,/from ['"](@\/lib\/server|\.\.?\/(\.\.\/)*lib\/server|\.\/server)/,path.relative(root,file)+' imports server code');
  assert.doesNotMatch(text,/GOOGLE_PLACES_API_KEY|GOOGLE_MAPS_BROWSER_KEY|REELTRIP_PROCESSOR_TOKEN|process\.env/,path.relative(root,file)+' reads a key directly (the map key comes from /api/map-config)');
 }
 // Shared browser helpers they import must also stay clear of secrets.
 for(const file of ['lib/places-client.ts','lib/shared-client.ts','lib/track.ts','lib/events.ts'])assert.doesNotMatch(readFileSync(path.join(root,file),'utf8'),/process\.env|lib\/server/,file);
});
