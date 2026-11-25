import test from 'node:test';
import assert from 'node:assert/strict';
import {reelPreviewSource} from '../lib/reel-preview.ts';
test('previews retain exact reel identity and discard tracking and injected parameters',()=>{
 assert.equal(reelPreviewSource('https://instagram.com/reel/DfsWbkrB6vN/?next=https://evil.test').embed,'https://www.instagram.com/p/DfsWbkrB6vN/embed/');
 assert.equal(reelPreviewSource('https://m.tiktok.com/@creator/video/12345?autoplay=1').embed,'https://www.tiktok.com/player/v1/12345?autoplay=0&description=1');
 assert.equal(reelPreviewSource('https://vm.tiktok.com/abc/').embed,null);
});
test('previews reject scripts, arbitrary frames, credentials and lookalike hosts',()=>{
 for(const url of ['javascript:alert(1)','https://evil.test/p/x/','https://instagram.com.evil.test/p/x/','https://user:pass@instagram.com/p/x/','https://instagram.com:8443/p/x/','https://instagram.com/p/x/embed/','https://instagram.com/p/%3Cscript%3E/','https://tiktok.com/@x/video/1/../../evil','https://127.0.0.1/p/x/'])assert.equal(reelPreviewSource(url),null,url);
});
