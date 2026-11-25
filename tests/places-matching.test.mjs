import test from 'node:test';
import assert from 'node:assert/strict';
import {matches} from '../lib/travel.ts';
import {resolve,isNamedVenue,venueName,similarity,areaAgrees} from '../lib/server/places/match.ts';
import {fixtureProvider} from '../lib/server/places/fixture.ts';

const c=(id,name,address)=>({id:'fixture_'+id.padEnd(10,'x'),name,address,lat:1,lng:2});
const input=(title,place,kind='Venue named in video')=>({key:'k',title,place,kind,category:'Food'});

test('confidence: exact name in the right area with no close rival is high',()=>{
 const r=resolve(input('Sunset drinks at Café Soul','Ella'),[c('a','Café Soul','Passara Road, Ella'),c('b','Soul Food Kitchen','Colombo')]);
 assert.deepEqual([r.status,r.confidence,r.candidate.name],['matched','high','Café Soul']);
});
test('confidence: a good name with an unknown area is medium, never high',()=>{
 const r=resolve(input('Yala National Park','Sri Lanka'),[c('a','Yala National Park','Southern Province, Sri Lanka')]);
 assert.deepEqual([r.status,r.confidence],['matched','medium']);
});
test('confidence: the wrong area stops a match even with the same name',()=>{
 const r=resolve(input('Paradise Cove','Midigama'),[c('a','Paradise Cove','Unawatuna')]);
 assert.equal(r.status,'possible');assert.equal(r.confidence,'low');
});
test('confidence: two equally good candidates in the area are only a possible match',()=>{
 const r=resolve(input('Cactus','Ahangama'),[c('a','Cactus','Ahangama'),c('b','Cactus','Ahangama Beach Road, Ahangama')]);
 assert.equal(r.status,'possible');
});
test('confidence: a same-name rival in another town does not block a high match',()=>{
 const r=resolve(input('Cactus','Ahangama area'),[c('a','Cactus Bar','Colombo'),c('b','Cactus','Ahangama')]);
 assert.deepEqual([r.status,r.confidence,r.candidate.name],['matched','high','Cactus']);
});
test('confidence: a weak name match is never auto-picked',()=>{
 const r=resolve(input('Pidurangala at sunrise','Sigiriya','Place named in video'),[c('a','Pidurangala Rock','Sigiriya')]);
 assert.deepEqual([r.status,r.confidence],['possible','low']);
 assert.equal(resolve(input('The Villa by Contemporary Ceylon','Arrival stop'),[c('a','The Villa Bentota','Bentota')]).status,'unmatched');
 assert.equal(resolve(input('Anything','Ella'),[]).status,'unmatched');
});
test('unknown stays unknown: unnamed venues, suggestions, routes and transport are never looked up',()=>{
 for(const kind of ['Area search · venue unnamed','Suggested stay search','Comparable experience','Booking platform named','Route named in video'])
  assert.equal(resolve(input('A base in Ella','Ella',kind),[c('a','Ella Hotel','Ella')]).status,'not_a_venue',kind);
 assert.equal(isNamedVenue({...input('Train','Ella'),category:'Transport'}),false);
 assert.equal(isNamedVenue(input('Kai','Ahangama','AI-identified · confirm the name')),true);
});
test('venue names and helpers',()=>{
 assert.equal(venueName('Breakfast at Paradise Cove'),'Paradise Cove');
 assert.equal(venueName('Pidurangala at sunrise'),'Pidurangala at sunrise');
 assert.equal(similarity('Café Soul','Cafe Soul'),1);
 assert.equal(areaAgrees('Arrival stop · exact location to confirm','Bentota'),null);
 assert.equal(areaAgrees('Ella','Passara Road, Ella, Sri Lanka'),true);
});
test('every catalogue place resolves sensibly with the sample provider',async()=>{
 const p=fixtureProvider(),out={};
 for(const m of matches)out[m.id]=resolve(m,await p.search(m.query)).status;
 assert.equal(out['cafe-soul'],'matched');assert.equal(out['sunrise'],'possible');
 assert.equal(out['ella-stay'],'not_a_venue');assert.equal(out['fitnomads-repeat-villa'],'unmatched');
 assert.ok(Object.values(out).filter(s=>s==='matched').length>=12);
});

