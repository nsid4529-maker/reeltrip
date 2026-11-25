import test from 'node:test';
import assert from 'node:assert/strict';
import {generateSharedPlan,sharedPlaceAnchor} from '../lib/shared-plan.ts';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';
import * as planning from '../lib/shared-plan.ts';
import * as handoff from '../lib/handoff.ts';

const place=(id,extra={})=>({id,title:id,place:'Kyoto',category:'Experiences',quote:'Visit '+id,second:12,up:1,down:0,myVote:1,...extra});
const reel=(id,places)=>({id,url:'https://www.instagram.com/p/'+id+'/',platform:'Instagram',title:'Ideas from '+id,creator:id,status:'ready',places});
const bucket=(extra={})=>({id:'bucket-1',trip:{start:'2099-01-02',end:'2099-01-05',travellers:3},reels:[reel('first',[place('Temple'),place('Cafe',{category:'Food'})])],...extra});
const stops=p=>p.itinerary.days.flatMap(d=>d.stops).filter(s=>s.matchId);

test('shared draft uses saved dates and only net-kept choices, independent of this viewer',()=>{
 const b=bucket({reels:[reel('first',[place('Kept',{up:3,down:1,myVote:-1}),place('Skipped',{up:1,down:2}),place('Tied',{up:1,down:1}),place('Unvoted',{up:0,down:0})])]});
 const p=generateSharedPlan(b);
 assert.deepEqual(stops(p).map(s=>s.title),['Kept']);
 assert.deepEqual(p.itinerary.days.map(d=>d.date),['2099-01-02','2099-01-03','2099-01-04','2099-01-05']);
 assert.deepEqual(p.undecided.map(c=>c.place.id),['Tied']);assert.equal(p.skipped,1);
 assert.equal(p.itinerary.days[0].stops.some(s=>s.matchId),false);assert.equal(p.itinerary.days.at(-1).stops.some(s=>s.matchId),false);
 const otherViewer={...b,reels:b.reels.map(r=>({...r,places:r.places.map(p=>({...p,myVote:0}))}))};
 assert.deepEqual(stops(generateSharedPlan(otherViewer)),stops(p));
});

test('invalid, missing, past and oversized date ranges return an actionable message',()=>{
 for(const [start,end] of [[null,null],['2099-02-30','2099-03-04'],['2099-02-04','2099-02-01'],['2020-01-01','2020-01-04'],['2099-01-01','2099-03-01']]){
  const p=generateSharedPlan(bucket({trip:{start,end,travellers:2}}));assert.equal(p.itinerary,null);assert.ok(p.reason);
 }
});

test('all skipped, tied or unvoted never fall back to whole-reel evidence',()=>{
 for(const [up,down] of [[0,1],[1,2],[1,1],[0,0]]){
  const p=generateSharedPlan(bucket({reels:[reel('first',[place('Do not schedule',{up,down})])]}));
  assert.equal(p.itinerary,null);assert.match(p.reason,/Keep an activity or restaurant/);
 }
});

test('excess kept ideas are visible and a short stay does not squeeze out travel days',()=>{
 const b=bucket({trip:{start:'2099-01-02',end:'2099-01-04',travellers:2},reels:[reel('first',[place('A'),place('B'),place('C',{up:4})])]});
 const p=generateSharedPlan(b);assert.deepEqual(stops(p).map(s=>s.title),['C','A']);assert.deepEqual(p.unscheduled.map(c=>c.place.id),['B']);
 const short=generateSharedPlan({...b,trip:{...b.trip,end:'2099-01-03'}});assert.equal(stops(short).length,0);assert.equal(short.unscheduled.length,3);
});

test('stays and transport stay visible as arrangements instead of fabricated timed activities',()=>{
 const p=generateSharedPlan(bucket({reels:[reel('first',[place('Temple'),place('Hotel',{category:'Stays'}),place('Train',{category:'Transport'})])]}));
 assert.deepEqual(stops(p).map(s=>s.title),['Temple']);assert.deepEqual(p.logistics.map(c=>c.place.id),['Hotel','Train']);assert.equal(p.unscheduled.length,0);
});

test('source attribution, meal slots and literal sunrise cues survive filtering',()=>{
 const p=generateSharedPlan(bucket({reels:[reel('first',[place('Sunrise hike'),place('Cafe',{category:'Food'})])]}));
 assert.deepEqual(stops(p).map(s=>[s.period,s.source,s.second]),[['Early morning','first',12],['Lunch','first',12]]);
});

test('identical kept places merge across reels without being falsely labelled unscheduled',()=>{
 const p=generateSharedPlan(bucket({reels:[reel('first',[place('a',{title:'Temple'})]),reel('second',[place('b',{title:'Temple'})])]}));
 assert.equal(stops(p).length,1);assert.deepEqual(stops(p)[0].alsoSources,[{source:'second',second:12}]);assert.equal(p.unscheduled.length,0);
});

test('changed votes and dates rebuild the draft without mutating saved places',()=>{
 const b=bucket(),original=JSON.stringify(b);assert.equal(stops(generateSharedPlan(b)).length,2);
 const changed={...b,reels:[reel('first',[place('Temple',{up:0,down:1}),place('Cafe',{category:'Food'})])],trip:{...b.trip,start:'2099-03-01',end:'2099-03-04'}};
 const p=generateSharedPlan(changed);assert.deepEqual(stops(p).map(s=>s.title),['Cafe']);assert.equal(p.itinerary.days[0].date,'2099-03-01');assert.equal(JSON.stringify(b),original);
});

test('generated view follows current props, links to evidence and has no stale draft after votes disappear',async()=>{
 const h=await componentHarness('components/shared-plan.tsx',{globals:browserGlobals(),exportName:'SharedTripPlan',props:{bucket:bucket()},modules:{'@/lib/shared-plan':planning,'@/lib/handoff':handoff}});
 await h.flush();assert.match(h.text(),/Generate trip plan/);assert.doesNotMatch(h.text(),/Day 1/);
 h.elements(n=>n.type==='button')[0].props.onClick();await h.flush();assert.match(h.text(),/Day 1/);assert.match(h.text(),/Nothing is booked/);
 assert.ok(h.elements(n=>n.type==='a'&&n.props.href==='#'+sharedPlaceAnchor('Temple')).length);
 h.render({bucket:bucket({reels:[reel('first',[place('Temple',{up:0,down:1})])]})});await h.flush();
 assert.doesNotMatch(h.text(),/Day 1/);assert.match(h.text(),/Keep an activity or restaurant/);
});

test('evidence links resolve to the card id for original-language and punctuation-containing keys',async()=>{
 const id='京都/Temple #2',b=bucket({reels:[reel('first',[place(id)])]});
 const h=await componentHarness('components/shared-plan.tsx',{exportName:'SharedTripPlan',props:{bucket:b}});
 h.elements(n=>n.type==='button')[0].props.onClick();await h.flush();
 const link=h.elements(n=>n.type==='a'&&h.text(n)==='View reel evidence & booking options')[0];
 assert.equal(decodeURIComponent(link.props.href.slice(1)),sharedPlaceAnchor(id));
});
