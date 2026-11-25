import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharedLinks} from '../lib/shared-links.ts';
test('receives link embedded in a caption and removes tracking',()=>{
 const r=sharedLinks(new URLSearchParams({text:'Look at this! https://www.instagram.com/reel/DeSbT_lEZGL/?igsh=tracking.'}));
 assert.deepEqual(r.links,['https://www.instagram.com/reel/DeSbT_lEZGL/']);
});
test('deduplicates URL and text payloads',()=>{const s='https://www.tiktok.com/@creator/video/123';assert.equal(sharedLinks(new URLSearchParams({url:s,text:s})).links.length,1);});
test('rejects lookalike hosts, credentials, profiles and arbitrary URLs',()=>{
 for(const url of ['https://instagram.com.evil.test/reel/abc','https://user@instagram.com/reel/abc','https://instagram.com/profile','https://example.com','javascript:alert(1)'])assert.deepEqual(sharedLinks(new URLSearchParams({url})).links,[]);
});
test('preserves short links with an honest pending-resolution message',()=>{const r=sharedLinks(new URLSearchParams({text:'https://vm.tiktok.com/Zabc/'}));assert.equal(r.links.length,1);assert.match(r.message,/Save it to your library/);});
test('bounds share payload size and count',()=>{assert.equal(sharedLinks(new URLSearchParams({text:'x'.repeat(8001)})).links.length,0);assert.equal(sharedLinks(new URLSearchParams({text:Array.from({length:5},(_,i)=>`https://instagram.com/reel/abc${i}`).join(' ')})).links.length,0);});
