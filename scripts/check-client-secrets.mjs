// Fails if a built browser bundle contains a server secret. The public map key
// (GOOGLE_MAPS_BROWSER_KEY) is served at runtime by /api/map-config, so it is not
// in the bundle either; any Google-key-shaped string here is therefore a leak.
// Run after a build:
//   GOOGLE_PLACES_API_KEY=AIzaCANARY_never_ship_0123456789 npm run build && node scripts/check-client-secrets.mjs AIzaCANARY_never_ship_0123456789
import {readdirSync,readFileSync,statSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[3]||'dist/client'),canary=process.argv[2]||'';
const patterns=[/GOOGLE_PLACES_API_KEY/,/REELTRIP_PROCESSOR_TOKEN/,/AIza[0-9A-Za-z_-]{30,}/,...(canary?[new RegExp(canary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))]:[])];
const files=[];(function walk(dir){for(const name of readdirSync(dir)){const file=path.join(dir,name);statSync(file).isDirectory()?walk(file):files.push(file);}})(root);
const leaks=files.flatMap(file=>{const text=readFileSync(file,'utf8');return patterns.filter(p=>p.test(text)).map(p=>path.relative(root,file)+' matches '+p);});
if(leaks.length){console.error('Secrets found in browser bundles:\n'+leaks.join('\n'));process.exit(1);}
console.log('No server secrets in '+files.length+' browser files.');
