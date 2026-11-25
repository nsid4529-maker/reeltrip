import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkspaceReturn} from '../lib/workspace-return.ts';
test('return context preserves a saved reel or bundle without accepting URLs as navigation targets',()=>{
 const bundleId='d41b9468-17f8-4e46-a313-5ff41406fdc9';
 assert.deepEqual(readWorkspaceReturn(JSON.stringify({version:1,reelId:'instagram:Dfo4fPMyHpo',bundleId,url:'https://evil.test'})),{reelId:'instagram:Dfo4fPMyHpo',bundleId});
});
test('invalid or obsolete return state safely opens the library',()=>{
 for(const raw of [null,'{','{}',JSON.stringify({version:2,reelId:'a'}),JSON.stringify({version:1,reelId:'a',bundleId:'bad'}),'a'.repeat(2049)])assert.equal(readWorkspaceReturn(raw),null);
});
