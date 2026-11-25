import test from 'node:test';
import assert from 'node:assert/strict';
import {readTripPreferences,withTripPreferences} from '../lib/trip-preferences.ts';
const date=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
test('travel navigation retains selected date window and unrelated saved work',()=>{
 const trip={dates:[{start:date(2),end:date(5)},{start:date(10),end:date(15)}],activeDate:1,adults:3,currency:'EUR',prompt:'Local food',selected:['ella']};
 const raw=JSON.stringify({trip,saved:['bridge']});const prefs=readTripPreferences(raw);
 assert.equal(prefs.activeDate,1);assert.equal(prefs.dates.length,2);
 const edited=JSON.parse(withTripPreferences(raw,{...prefs,adults:4}));
 assert.equal(edited.trip.prompt,'Local food');assert.deepEqual(edited.saved,['bridge']);assert.deepEqual(edited.trip.selected,['ella']);assert.equal(edited.trip.adults,4);assert.equal(edited.trip.activeDate,1);
});
test('invalid preferences default safely and corrupt records are never overwritten',()=>{
 const prefs=readTripPreferences(JSON.stringify({trip:{dates:[{start:'2020-01-01',end:'2020-01-02'}],activeDate:9,adults:-3,currency:'XSS'}}));
 assert.deepEqual(prefs,{dates:[{start:'',end:''}],activeDate:0,adults:2,currency:'GBP'});
 assert.throws(()=>withTripPreferences('{bad',prefs));assert.throws(()=>withTripPreferences('[]',prefs));
});
