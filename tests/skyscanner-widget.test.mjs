import {test} from 'node:test';
import assert from 'node:assert/strict';
import {skyscannerWidgetDocument,SKYSCANNER_WIDGET_LOADER_URL} from '../lib/skyscanner-widget.ts';
import {skyscannerSearchUrl} from '../lib/travel-connections.ts';

const flight={origin:'LHR',destination:'AMS',dates:{start:'2099-01-02',end:'2099-01-05'},adults:3,currency:'GBP',outboundTime:{from:'06:00',to:'12:00'},returnTime:{from:'12:00',to:'18:00'}};

test('official search widget uses documented route/date/currency options and the official loader',()=>{
 const html=skyscannerWidgetDocument({...flight,origin:' lhr ',destination:'ams'});
 for(const attribute of ['data-skyscanner-widget="FlightSearchWidget"','data-origin-iata-code="LHR"','data-destination-iata-code="AMS"','data-flight-type="return"','data-flight-outbound-date="2099-01-02"','data-flight-inbound-date="2099-01-05"','data-currency="GBP"','data-target="_blank"','data-multi-city-max-flights-number="0"'])assert.ok(html.includes(attribute),attribute);
 assert.deepEqual([...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match=>match[1]),[SKYSCANNER_WIDGET_LOADER_URL]);
 assert.ok(!/data-(?:associate|affiliate|partner)-id=/.test(html));
 // The widget has no documented party/time presets; the fallback does.
 assert.ok(!/data-(?:adults|flights-adults-number|departure-times)=/.test(html));
});

test('widget fallback preserves the complete provider search and safely escapes its URL',()=>{
 const html=skyscannerWidgetDocument(flight);
 const encoded=html.match(/<a href="([^"]+)"/)[1];
 assert.ok(encoded.includes('&amp;'));
 const url=new URL(encoded.replaceAll('&amp;','&'));
 assert.equal(url.href,skyscannerSearchUrl(flight));
 assert.equal(url.origin,'https://www.skyscanner.net');
 assert.equal(url.searchParams.get('adultsv2'),'3');
 assert.equal(url.searchParams.get('departure-times'),'360-720,720-1080');
 assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('HTML, script and URL payloads cannot enter widget attributes or fallback navigation',()=>{
 const payloads=['"><script src="https://evil.test/x"></script>','AMS" onload="alert(1)','javascript:alert(1)','//evil.test','LHR/../../evil','LHR\nAMS'];
 for(const payload of payloads){
  for(const field of ['origin','destination','currency'])assert.throws(()=>skyscannerWidgetDocument({...flight,[field]:payload}));
  assert.throws(()=>skyscannerWidgetDocument({...flight,dates:{start:payload,end:flight.dates.end}}));
  assert.throws(()=>skyscannerWidgetDocument({...flight,dates:{start:flight.dates.start,end:payload}}));
 }
});

test('invalid dates and party boundaries cannot create a misleading widget',()=>{
 for(const dates of [{start:'2099-02-30',end:'2099-03-05'},{start:'2099-01-02',end:'2099-01-02'},{start:'2099-01-05',end:'2099-01-02'},{start:'2020-01-01',end:'2020-01-05'},{start:'',end:''}])assert.throws(()=>skyscannerWidgetDocument({...flight,dates}));
 for(const adults of [0,9,1.5,NaN])assert.throws(()=>skyscannerWidgetDocument({...flight,adults}));
 for(const adults of [1,8])assert.doesNotThrow(()=>skyscannerWidgetDocument({...flight,adults}));
 assert.throws(()=>skyscannerWidgetDocument({...flight,origin:'AMS'}));
 assert.throws(()=>skyscannerWidgetDocument({...flight,returnTime:{from:'24:00',to:'25:00'}}));
});

test('the embed reserves visible space when the provider loader initially sets its nested iframe to zero height',()=>{
 const html=skyscannerWidgetDocument(flight);
 assert.match(html,/<div class="skyscanner-frame"><div data-skyscanner-widget="FlightSearchWidget"/);
 assert.match(html,/\.skyscanner-frame\{position:relative;min-height:640px\}/);
 assert.match(html,/\.skyscanner-frame iframe\{min-height:640px\}/);
 assert.match(html,/@media\(max-width:480px\)\{\.skyscanner-frame,\.skyscanner-frame iframe\{min-height:800px\}\}/);
 // Padding must not reduce the official 300px minimum widget width.
 assert.ok(!/body\{[^}]*padding:/.test(html));
});
