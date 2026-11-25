import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeLibraryError} from '../lib/native-library.ts';

test('error-only native responses remain visible without videos or pending interests',()=>{
 assert.equal(nativeLibraryError({error:'Your saved items could not be loaded. Please reopen ReelTrip.'}),'Your saved items could not be loaded. Please reopen ReelTrip.');
 assert.equal(nativeLibraryError({videos:[],pendingInterests:[]}),null);
});
test('native errors accept bounded text only and strip control characters',()=>{
 for(const payload of [null,[],true,'Error',{error:42},{error:{}},{error:' \n\u0000 '}])assert.equal(nativeLibraryError(payload),null);
 assert.equal(nativeLibraryError({error:'\u0000Storage\nfailed\u007f'}),'Storage failed');
 assert.equal(nativeLibraryError({error:'x'.repeat(10000)}).length,240);
});
