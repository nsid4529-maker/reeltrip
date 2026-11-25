import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {calendarDay,calendarDayIn,calendarTimeZone,localTimeZone} from '../lib/calendar-day.ts';
import * as travel from '../lib/travel.ts';
import * as calendar from '../lib/calendar-day.ts';
import * as availability from '../lib/availability.ts';
import {readRequestBody} from '../lib/server/request-body.ts';
import {ServiceError} from '../lib/server/http-safety.ts';
import {readActivityContext} from '../lib/activity-context.ts';
import {choiceDates} from '../lib/saved-choice-links.ts';
import {viatorCatalogRequest} from '../lib/viator-results.ts';
import {bookingSearch,skyscannerQuery} from '../lib/travel-connections.ts';

function clock(t,instant,timeZone){
 const previous=process.env.TZ;process.env.TZ=timeZone;
 t.after(()=>{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;});
 t.mock.timers.enable({apis:['Date'],now:Date.parse(instant)});
}
const preferences=dates=>({name:'A trip',destination:'Los Angeles',dates:[dates],activeDate:0,adults:2,currency:'GBP',brief:''});
const activity={...travel.matches.find(match=>match.category==='Experiences'),place:'Los Angeles',query:'Los Angeles walking tour'};
const request=(dates,timeZone)=>({matchIds:['cafe-soul'],dates,day:dates.start,adults:2,currency:'GBP',dining:{date:dates.start,time:'19:00',covers:2},timeZone});
const flight=dates=>({origin:'LAX',destination:'LHR',start:dates.start,end:dates.end,adults:2,currency:'GBP',country:'US',platform:'desktop',hotelCity:123});

test('a western local today survives UI preparation and requests after UTC midnight',t=>{
 clock(t,'2026-11-20T00:30:00Z','America/Los_Angeles');
 const dates={start:'2026-11-19',end:'2026-11-21'};
 assert.equal(calendarDay(),'2026-11-19');assert.equal(localTimeZone(),'America/Los_Angeles');
 travel.validateDates([dates]);assert.throws(()=>travel.validateDates([{...dates,start:'2026-11-18'}]));
 assert.deepEqual(choiceDates(preferences(dates)),dates);
 assert.equal(readActivityContext(new URLSearchParams({...dates,destination:'Los Angeles'})).start,dates.start);
 assert.equal(travel.hotelSearchLinks('Los Angeles',dates).length,3);
 const catalog=viatorCatalogRequest(activity,dates,'GBP');assert.equal(catalog.timeZone,'America/Los_Angeles');
 availability.validateAvailability(request(dates,catalog.timeZone));
 const search={...flight(dates),timeZone:catalog.timeZone};
 assert.equal(bookingSearch(search).checkin,dates.start);assert.equal(skyscannerQuery(search).query.queryLegs[0].date.day,19);
});

test('an eastern local yesterday is rejected even while UTC is still on that date',t=>{
 clock(t,'2026-11-19T23:30:00Z','Asia/Tokyo');
 assert.equal(calendarDay(),'2026-11-20');
 travel.validateDates([{start:'2026-11-20',end:'2026-11-21'}]);
 assert.throws(()=>travel.validateDates([{start:'2026-11-19',end:'2026-11-21'}]));
 assert.throws(()=>availability.validateAvailability(request({start:'2026-11-19',end:'2026-11-21'},'Asia/Tokyo')));
});

test('timezone inputs cannot replace the server clock or remove date limits',t=>{
 clock(t,'2026-11-20T00:30:00Z','UTC');
 const dates={start:'2026-11-20',end:'2026-11-21'};
 for(const timeZone of [null,{},'', '1900-01-01','UTC+9999','Etc/GMT+25','+99:00','a'.repeat(101)]){
  assert.throws(()=>calendarTimeZone(timeZone));
  assert.throws(()=>availability.validateAvailability(request(dates,timeZone)));
 }
 availability.validateAvailability(request(dates,undefined));
 for(const bad of [{start:'2026-11-19',end:'2026-11-21'},{start:'2026-02-30',end:'2026-03-01'},{start:'2026-11-21',end:'2026-11-20'},{start:'2026-11-20',end:'2026-12-21'}]){
  assert.throws(()=>availability.validateAvailability({...request(bad,'UTC'),today:'1900-01-01'}));
 }
 assert.equal(calendarDay('Pacific/Kiritimati'),'2026-11-20');
 assert.equal(calendarDay('Etc/GMT+12'),'2026-11-19');
});

test('calendar-day increments remain whole dates across daylight-saving changes',()=>{
 assert.equal(calendarDayIn(1,'America/Los_Angeles',new Date('2026-03-08T07:30:00Z')),'2026-03-08');
 assert.equal(calendarDayIn(2,'America/Los_Angeles',new Date('2026-03-08T07:30:00Z')),'2026-03-09');
 assert.equal(calendarDayIn(1,'America/Los_Angeles',new Date('2026-11-01T06:30:00Z')),'2026-11-01');
});

async function route(file,dependencies){
 const output=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new vm.Script(output,{filename:file}).runInNewContext({exports,require:name=>{assert.ok(name in dependencies,name);return dependencies[name];},process:{env:{}},Response,Request,URL,console});return exports.POST;
}

test('actual API routes derive local today from validated timezone before any provider work',async t=>{
 clock(t,'2026-11-20T00:30:00Z','UTC');
 let providerCalls=0;
 const dependencies={'@/lib/travel':travel,'@/lib/calendar-day':calendar,'@/lib/availability':availability,'@/lib/server/request-body':{readRequestBody},'@/lib/server/processing':{ServiceError,cachedAnalysis:async()=>null,quota:async()=>{throw Error('No quota/provider work expected');}},'@/lib/server/viator-catalog':{viatorCatalogConfig:()=>null,searchViatorCatalog:async()=>{providerCalls++;throw Error('Must not call provider');}},'@/lib/server/availability':{checkAvailability:async()=>{providerCalls++;return [];}}};
 const viator=await route('app/api/viator/route.ts',dependencies),available=await route('app/api/availability/route.ts',dependencies);
 const dates={start:'2026-11-19',end:'2026-11-21'},post=body=>new Request('https://reeltrip.test/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const catalog={query:'Los Angeles walking tour',place:'Los Angeles',dates,currency:'GBP',timeZone:'America/Los_Angeles'};
 assert.equal((await viator(post(catalog))).status,503,'valid request reaches unconfigured-provider response');
 assert.equal((await available(post(request(dates,'America/Los_Angeles')))).status,200);
 const callsAfterValid=providerCalls;
 for(const timeZone of ['UTC','Bad/Timezone','1900-01-01',null]){
  assert.equal((await viator(post({...catalog,timeZone,today:'1900-01-01'}))).status,400);
  assert.equal((await available(post({...request(dates,timeZone),today:'1900-01-01'}))).status,400);
 }
 assert.equal(providerCalls,callsAfterValid,'invalid dates and zones never reach provider work');
});
