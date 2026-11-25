import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateItinerary,itinerarySignature} from '../lib/itinerary.ts';
import {matches} from '../lib/travel.ts';
const trip={prompt:'Waterfalls and relaxed days in Ella',selected:['ella','sigiriya','shreya','kanisha'],dates:[{start:'2099-01-02',end:'2099-01-05'}],activeDate:0,adults:2,currency:'GBP'};
test('full draft covers every calendar date and protects arrival/departure',()=>{
 const plan=generateItinerary(trip);assert.equal(plan.region,'ella');assert.equal(plan.nights,3);assert.equal(plan.days.length,4);assert.equal(plan.days[0].title,'Arrive & settle in');assert.equal(plan.days.at(-1).title,'Departure day');assert.ok(plan.days[1].stops.some(s=>s.title.includes('Ravana')));assert.ok(plan.days[2].stops.some(s=>s.title.includes('Peak')));assert.ok(plan.days[1].stops.some(s=>s.period==='Lunch'));assert.ok(plan.days[1].stops.some(s=>s.period==='Dinner'));
});
test('draft only attributes evidence to selected clips and reports other regions',()=>{
 for(const selected of [['ella'],['sigiriya'],['shreya'],['kanisha']]){const plan=generateItinerary({...trip,selected});assert.ok(plan.days.flatMap(d=>d.stops).filter(s=>s.source).every(s=>selected.includes(s.source)));}
 const plan=generateItinerary(trip,'coast');assert.equal(plan.region,'coast');assert.ok(plan.otherSources.includes('ella'));assert.ok(plan.days[1].stops.some(s=>s.matchId==='paradise-breakfast'));
});
test('unsupported bases, empty sources and invalid dates fail rather than inventing an itinerary',()=>{
 assert.throws(()=>generateItinerary({...trip,selected:[]}));assert.throws(()=>generateItinerary({...trip,selected:['ella']},'coast'));assert.throws(()=>generateItinerary({...trip,dates:[{start:'2099-01-05',end:'2099-01-02'}]}));
});
test('long trips retain flexible days instead of duplicating invented sights',()=>{
 const plan=generateItinerary({...trip,dates:[{start:'2099-01-02',end:'2099-01-10'}]});assert.equal(plan.days.length,9);assert.ok(plan.days.some(d=>d.title==='A flexible day'));assert.ok(plan.warnings.some(w=>w.includes('enough distinct')));
});
test('changing dates, scope or base invalidates the draft signature',()=>{
 const first=itinerarySignature(trip,'auto');assert.notEqual(first,itinerarySignature({...trip,adults:4},'auto'));assert.notEqual(first,itinerarySignature({...trip,selected:['ella']},'auto'));assert.notEqual(first,itinerarySignature(trip,'ella'));
});
const analysis=(id,title='A cafe',place='Rome')=>({source:{id,platform:'Instagram',source_url:'https://instagram.com/reel/'+id,title:'Ideas for '+place,creator:id,scope:place,analysis_kind:'ai',days:[{day:0,items:[{details:'Visit '+title,time_seconds:[12,16]}]}],unknowns:['Travel time']},matches:[{id:id+'-place',source:id,title,place,category:'Food',kind:'AI-identified',quote:'Visit '+title,second:12,query:title+' '+place,providers:['OpenTable'],note:'Confirm opening hours.'}]});
test('new video itineraries use only their own evidence and protect travel days',()=>{
 const a=analysis('rome');const plan=generateItinerary({...trip,selected:['rome']},'auto',a);
 assert.equal(plan.region,'custom');assert.equal(plan.days.length,4);assert.equal(plan.days[1].stops.find(s=>s.source)?.source,'rome');
 assert.ok(!JSON.stringify(plan).includes('Ravana'));assert.ok(plan.days[0].stops.every(s=>!s.source));assert.ok(plan.days.at(-1).stops.every(s=>!s.source));
 assert.ok(plan.warnings.some(w=>w.includes('AI')));assert.ok(plan.warnings.some(w=>w.includes('distances')));
});
test('collection itinerary merges exact places while retaining every creator attribution',()=>{
 const a=analysis('one'),b=analysis('two'),c=analysis('three','A cafe','Paris');
 const plan=generateItinerary({...trip,selected:['one','two','three']},'auto',[a,b,c]);
 assert.deepEqual(plan.includedSources,['one','two','three']);
 const named=plan.days.flatMap(d=>d.stops).filter(s=>s.source);assert.equal(named.length,2);
 assert.equal(named[0].source,'one');assert.deepEqual(named[0].alsoSources,[{source:'two',second:12}]);assert.equal(named[1].source,'three');
 assert.ok(plan.warnings.some(w=>w.includes('3 reels')));
});
test('combined plans reject incomplete source coverage and invalidate when evidence changes',()=>{
 const a=analysis('one'),b=analysis('two');
 assert.throws(()=>generateItinerary({...trip,selected:['one','two']},'auto',[a]),/All selected/);
 assert.throws(()=>generateItinerary({...trip,selected:['one']},'auto',[a,b]),/every selected/);
 const t={...trip,selected:['one','two']};
 assert.notEqual(itinerarySignature(t,'auto',[a,b]),itinerarySignature(t,'auto',[a,analysis('two','A different cafe')]));
});
test('three-night Ella and Sigiriya collection covers each source and respects sunrise/sunset',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8'));
 const selected=['ella','sigiriya'],collection=selected.map(id=>({source:catalog.find(s=>s.id===id),matches:matches.filter(m=>m.source===id)}));
 const plan=generateItinerary({...trip,selected},'auto',collection),first=plan.days[1].stops.filter(s=>s.source),second=plan.days[2].stops.filter(s=>s.source);
 assert.ok(first.every(s=>s.source==='ella'));assert.ok(second.every(s=>s.source==='sigiriya'));
 assert.equal(first.find(s=>s.matchId==='cafe-soul').period,'Evening');
 assert.equal(second.find(s=>s.matchId==='sunrise').period,'Early morning');
 assert.equal(second.find(s=>s.matchId==='safari').period,'Afternoon');
 assert.ok(plan.warnings.some(w=>w.includes('Ideas not scheduled')&&w.includes('Nine Arch Bridge')&&w.includes('Ravana Pool Club')));
 assert.deepEqual(plan.includedSources,selected);assert.ok(plan.warnings.some(w=>w.includes('distances')));
});
test('breakfast and unqualified food recommendations use meal slots without inventing morning visits',()=>{
 const a=analysis('food','Breakfast at a cafe'),b=analysis('dining','An excellent restaurant');
 const plan=generateItinerary({...trip,selected:['food','dining']},'auto',[a,b]);
 assert.equal(plan.days[1].stops.find(s=>s.source)?.period,'Breakfast');
 assert.equal(plan.days[2].stops.find(s=>s.source)?.period,'Lunch');
});
test('sources that cannot fit are explicit rather than claimed as itinerary coverage',()=>{
 const a=analysis('one','First cafe'),b=analysis('two','Second cafe');
 const plan=generateItinerary({...trip,selected:['one','two'],dates:[{start:'2099-01-02',end:'2099-01-04'}]},'auto',[a,b]);
 assert.deepEqual(plan.includedSources,['one']);assert.deepEqual(plan.otherSources,['two']);
 assert.ok(plan.warnings.some(w=>w.includes('Second cafe')));assert.ok(plan.warnings.some(w=>w.includes('No stop from these reels')));
 const short=generateItinerary({...trip,selected:['one','two'],dates:[{start:'2099-01-02',end:'2099-01-03'}]},'auto',[a,b]);
 assert.deepEqual(short.includedSources,[]);assert.deepEqual(short.otherSources,['one','two']);
});
test('party weekdays constrain dates and closed venues are excluded',()=>{
 const a=analysis('party','Lazies');a.matches[0].category='Experiences';a.matches[0].quote='TUESDAY Lazies';a.matches[0].note='A Tuesday party recommended by the creator.';
 const closed=analysis('closed','Trax');closed.matches[0].quote='Monday Trax closed for maintenance';
 const t={...trip,selected:['party','closed'],dates:[{start:'2099-01-04',end:'2099-01-12'}]};
 const plan=generateItinerary(t,'auto',[a,closed]);
 const d=plan.days.find(d=>d.stops.some(s=>s.source==='party'));
 assert.ok(d);assert.equal(new Date(d.date+'T12:00:00Z').getUTCDay(),2);
 assert.equal(d.stops.find(s=>s.source==='party').period,'Night');
 assert.ok(!plan.days.flatMap(d=>d.stops).some(s=>s.source==='closed'));
 assert.equal(plan.stayId,'');assert.ok(plan.warnings.some(w=>w.includes('Weekday')));
});
test('new reviewed source retains named dining and practical train tips without borrowing old templates',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8')),source=catalog.find(s=>s.id==='fitnomads-repeat');
 const a={source,matches:matches.filter(m=>m.source===source.id)};
 assert.equal(a.matches.filter(m=>m.category==='Food').length,5);
 assert.ok(source.practical_tips.some(t=>/train/i.test(t.details)&&/Kandy/i.test(t.details)));
 const plan=generateItinerary({...trip,selected:[source.id]},'auto',a);assert.equal(plan.region,'custom');assert.ok(plan.days.flatMap(d=>d.stops).filter(s=>s.source).every(s=>s.source===source.id));assert.ok(plan.warnings.some(w=>w.includes('transfer')));
});
test('meal links match breakfast/lunch slots and a cross-region reel does not assume one hotel base',async()=>{
 const {itineraryMealTime}=await import('../lib/itinerary.ts');assert.equal(itineraryMealTime('Breakfast','19:30'),'09:00');assert.equal(itineraryMealTime('Lunch','19:30'),'13:00');assert.equal(itineraryMealTime('Dinner','19:30'),'19:30');
 const catalog=JSON.parse(readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8')),source=catalog.find(s=>s.id==='fitnomads-repeat');
 const plan=generateItinerary({...trip,selected:[source.id]},'auto',{source,matches:matches.filter(m=>m.source===source.id)});assert.equal(plan.stayId,'');
});
