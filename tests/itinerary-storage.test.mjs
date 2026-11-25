import test from 'node:test';
import assert from 'node:assert/strict';
import {GUEST_ITINERARY_KEY,itineraryStorageKey} from '../lib/itinerary-storage.ts';
test('trip itinerary and notes saves never use another trip or the legacy guest key',()=>{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',storage=new Map();
 storage.set(itineraryStorageKey(),{draft:'Guest itinerary',notes:'Keep my existing notes'});
 storage.set(itineraryStorageKey(a),{draft:'Sri Lanka itinerary',notes:'Train at 09:00'});
 storage.set(itineraryStorageKey(b),{draft:'Amsterdam itinerary',notes:'Lunch reservation to check'});
 storage.set(itineraryStorageKey(a),{draft:'Updated Sri Lanka itinerary',notes:'Train at 10:00'});
 assert.equal(storage.get(itineraryStorageKey(b)).notes,'Lunch reservation to check');
 assert.equal(storage.get(GUEST_ITINERARY_KEY).notes,'Keep my existing notes');
 assert.equal(storage.size,3);
});
test('scope keys are canonical and invalid supplied scopes never fall back to guest storage',()=>{
 const scope='ABCDEF12-3456-4789-ABCD-123456789ABC';
 assert.equal(itineraryStorageKey(scope),itineraryStorageKey(scope.toLowerCase()));
 for(const invalid of ['', '../guest','reeltrip-itinerary-v1','__proto__','unassigned','a'.repeat(1000)])assert.equal(itineraryStorageKey(invalid),null);
 assert.equal(itineraryStorageKey(),GUEST_ITINERARY_KEY);
});
