import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {d1} from './helpers/route-harness.mjs';
import {componentHarness} from './helpers/component-harness.mjs';
import {EVENT_PROPS} from '../lib/events.ts';
import {MEMBER_COOKIE} from '../lib/server/members.ts';
const {INVITE_DAYS}=await import('../lib/server/shared-buckets.ts');

// The privacy notice must match what the code stores. If a table, cookie or
// event is added, this fails until the notice says so.
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const page=read('app/privacy/page.tsx');
const listed=name=>JSON.parse(page.match(new RegExp('export const '+name+'=(\\[[^\\]]*\\])'))[1].replaceAll("'",'"'));
async function rendered(){const h=await componentHarness('app/privacy/page.tsx',{modules:{'@/components/workspace-navigation':{WorkspaceHeader:()=>null},'@/lib/events':{EVENT_PROPS}}});await h.flush();return h.text();}

test('every database table is listed, and nothing that does not exist',()=>{
 const tables=[...read('db/schema.ts').matchAll(/sqliteTable\('([a-z_]+)'/g)].map(m=>m[1]).sort();
 assert.deepEqual([...listed('SERVER_TABLES')].sort(),tables);
});

test('video service storage is included separately from the web database',()=>{
 const worker=read('extraction-worker/service/jobs.py')+read('extraction-worker/service/uploads.py');
 const tables=[...worker.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(m=>m[1]).sort();
 assert.deepEqual([...listed('PROCESSOR_TABLES')].sort(),tables);
});

test('every cookie the server sets is listed',()=>{
 const upload=read('lib/server/upload-owner.ts').match(/const COOKIE='([^']+)'/)[1];
 assert.deepEqual(listed('COOKIES').sort(),[MEMBER_COOKIE,upload].sort());
 const cookieNames=[...read('lib/server/members.ts').matchAll(/MEMBER_COOKIE='([^']+)'/g)].map(m=>m[1]);assert.deepEqual(cookieNames,[MEMBER_COOKIE]);
});

test('the notice describes exactly the allow-listed events',async()=>{
 const text=await rendered();
 for(const name of Object.keys(EVENT_PROPS))assert.ok(page.includes(' '+name+':'),'a plain-English line for '+name);
 for(const label of ['Reel added','Place viewed','Vote cast','Member joined','Shortlist agreed','Booking link clicked'])assert.match(text,new RegExp(label));
 assert.equal(Object.keys(EVENT_PROPS).length,6,'a new event needs a line in the notice');
 assert.deepEqual(Object.keys(EVENT_PROPS.outbound_click),['provider','linkType'],'booking clicks carry no address, venue or dates');
 assert.match(text,/Place IDs may be derived from place names/);
 assert.match(text,/your member ID when available, and the supplied bucket ID/);
 assert.doesNotMatch(text,/names and email addresses can’t be recorded/);
});

test('Google storage claims match the places code and schema',async()=>{
 const text=await rendered();
 assert.match(text,/Google coordinates are fetched live when you open the map and are not saved in ReelTrip’s database/);
 assert.doesNotMatch(text,/expire from use after 29 days|remain stored longer if there are no requests/);
 const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>read('drizzle/'+f).replaceAll('--> statement-breakpoint','')).join('\n');
 const columns=d1(migrations).db.prepare('PRAGMA table_info(place_resolutions)').all().map(c=>c.name);
 assert.ok(columns.includes('provider_place_id'),'place IDs are retained');
 for(const never of ['lat','lng','location_expires_at','name','address','maps_uri','google_maps_uri','opening'])assert.ok(!columns.includes(never),'no '+never+' column');
 assert.match(text,/name, address and Google Maps link are fetched live each time you open a place and are never stored/);
 assert.match(text,/attributed to Google Maps/);
 assert.equal(INVITE_DAYS,14);assert.match(text,/Each works for 14 days/);
});

test('retention and deletion describe current cleanup instead of an unimplemented deadline',async()=>{
 const text=await rendered();
 assert.match(text,/Expires from use after 1 day; expired rows are cleared on a later analysis request/);
 assert.match(text,/Completed and failed records older than 7 days are cleared on a new job submission/);
 assert.match(text,/Metadata remains for at least 14 days, and while a recent analysis needs it/);
 assert.match(text,/those requests are handled manually/);
 assert.match(text,/Siddarth Nair.*privacy@example\.com/);
 assert.match(page,/href="mailto:privacy@example\.com"/);
 assert.match(text,/Siddarth coordinates any necessary cache, processor, provider or device cleanup/);
 assert.match(text,/Siddarth is responsible for arranging, carrying out and checking the test-wide cleanup/);
 assert.match(text,/Deleting a bucket does not remove the separate analysis cache, video service jobs or uploads, global place matches, provider records or your device’s personal library/);
 assert.match(text,/The iPhone app also keeps saved reel links, personal bundle details, a shared-bucket picker cache and pending share or Interested saves in its own device storage, without automatic expiry/);
 assert.match(text,/Clearing browser data or deleting a shared bucket does not clear these native files/);
 assert.match(text,/There is no automatic end-of-test deletion/);
 assert.doesNotMatch(text,/90 days after the test|delete your data within 7 days|job records are deleted after 7 days/);
});

test('processing disclosure names the configured downloaders without promising deletion at providers',async()=>{
 const text=await rendered();
 for(const provider of ['Railway','OpenAI','tikwm','Apify','Google','Cloudflare'])assert.ok(text.includes(provider),provider);
 assert.match(text,/deleting a bucket does not delete their records/);
 assert.match(text,/does not publish copies of their videos/);
 assert.doesNotMatch(text,/don’t sell or share your data|Raw video and audio are not kept|ReelTrip shows no prices/);
});

test('the notice is linked from join, start and the in-bucket guide',()=>{
 const ui=read('components/shared-bucket.tsx');
 assert.ok((ui.match(/href="\/privacy"/g)||[]).length>=4,'join, start a group trip, guide and delete note');
});
