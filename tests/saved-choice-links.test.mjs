import test from 'node:test';
import assert from 'node:assert/strict';
import {choiceDates,savedChoiceHandoff} from '../lib/saved-choice-links.ts';
import {providerProduct} from '../lib/provider-links-save.ts';
import {skyscannerSearchUrl} from '../lib/travel-connections.ts';
const prefs={name:'Amsterdam',destination:'Amsterdam',dates:[{start:'2099-02-10',end:'2099-02-14'}],activeDate:0,adults:4,currency:'EUR',brief:''};
const item=(kind,url)=>({kind,url,title:'Saved choice',place:'Amsterdam',provider:'Saved provider'});
test('saved flight search retains cabin and direct-only preferences after dates change',()=>{
 const original=skyscannerSearchUrl({origin:'LHR',destination:'CMB',dates:{start:'2099-01-01',end:'2099-01-07'},adults:3,currency:'GBP',cabin:'business',directOnly:true,outboundTime:{from:'06:00',to:'12:00'}});
 const product=providerProduct(original);assert.ok(product);assert.equal(product.url,original);
 const result=savedChoiceHandoff(item('flight',product.url),prefs),url=new URL(result.currentUrl);
 assert.equal(url.searchParams.get('cabinclass'),'business');assert.equal(url.searchParams.get('preferdirects'),'true');
 assert.equal(url.searchParams.get('departure-times'),'360-720,0-1439');assert.equal(url.searchParams.get('adultsv2'),'4');
 assert.equal(providerProduct(original+'&preferdirects=false'),null);
 assert.equal(providerProduct(original.replace('preferdirects=true','preferdirects=whatever')),null);
});
test('refreshing saved dates also keeps validated nearby-airport choices',()=>{
 const original=new URL(skyscannerSearchUrl({origin:'LHR',destination:'AMS',dates:{start:'2099-01-01',end:'2099-01-07'},adults:2,currency:'GBP'}));
 original.searchParams.set('outboundaltsenabled','true');original.searchParams.set('inboundaltsenabled','true');
 const result=savedChoiceHandoff(item('flight',original.href),prefs),url=new URL(result.currentUrl);
 assert.equal(url.searchParams.get('outboundaltsenabled'),'true');assert.equal(url.searchParams.get('inboundaltsenabled'),'true');
 assert.equal(url.searchParams.get('adultsv2'),'4');assert.equal(result.originalUrl,original.href);
});
test('supported activity handoffs keep exact product identity and reflect current selected dates/guests',()=>{const saved=item('activity','https://www.getyourguide.com/amsterdam-l36/cruise-t907734/?date_from=2099-01-01&_pc=1,2');const before=structuredClone(saved),result=savedChoiceHandoff(saved,prefs);assert.equal(providerProduct(result.currentUrl).identity,providerProduct(saved.url).identity);const url=new URL(result.currentUrl);assert.equal(url.searchParams.get('date_from'),'2099-02-10');assert.equal(url.searchParams.get('_pc'),'1,4');assert.deepEqual(saved,before);assert.match(result.originalUrl,/2099-01-01/);});
test('new flight handoffs retain route and departure filters without changing original saved search identity',()=>{const original=skyscannerSearchUrl({origin:'LHR',destination:'AMS',dates:{start:'2099-01-01',end:'2099-01-07'},adults:2,currency:'GBP',outboundTime:{from:'06:00',to:'12:00'},returnTime:{from:'18:00',to:'23:59'}}),saved=item('flight',original),result=savedChoiceHandoff(saved,prefs),url=new URL(result.currentUrl);assert.equal(url.pathname,'/transport/flights/lhr/ams/990210/990214/');assert.equal(url.searchParams.get('adultsv2'),'4');assert.equal(url.searchParams.get('currency'),'EUR');assert.equal(url.searchParams.get('departure-times'),'360-720,1080-1439');assert.equal(saved.url,original);assert.equal(result.originalUrl,original);assert.notEqual(providerProduct(result.currentUrl).identity,providerProduct(original).identity);assert.match(result.notice,/original saved search is unchanged/);});
test('unsupported exact hotel and restaurant pages retain identity without invented URL parameters',()=>{for(const saved of [item('hotel','https://www.booking.com/hotel/nl/example.html'),item('restaurant','https://www.opentable.co.uk/r/the-ivy-in-the-park-london'),item('activity','https://www.viator.com/tours/Amsterdam/Canal-Cruise/d525-123P1')]){const result=savedChoiceHandoff(saved,prefs);assert.equal(result.currentUrl,null);assert.equal(result.originalUrl,saved.url);assert.match(result.notice,/does not automatically update/);}});
test('invalid dates keep original link and never create misleading current searches; single-day activities work',()=>{const saved=item('activity','https://www.getyourguide.com/amsterdam-l36/cruise-t907734/');for(const dates of [{start:'2020-01-01',end:'2020-01-02'},{start:'2099-02-30',end:'2099-03-02'},{start:'2099-01-01',end:'2099-03-01'}]){assert.equal(savedChoiceHandoff(saved,{...prefs,dates:[dates]}).currentUrl,null);}const day={...prefs,dates:[{start:'2099-02-10',end:''}]};assert.deepEqual(choiceDates(day),{start:'2099-02-10',end:'2099-02-10'});assert.equal(choiceDates(day,true),undefined);assert.equal(choiceDates({...day,dates:[{start:'2099-02-10',end:'2099-02-10'}]},true),undefined);assert.ok(savedChoiceHandoff(saved,day).currentUrl);assert.equal(savedChoiceHandoff(item('hotel','javascript:alert(1)'),prefs).originalUrl,null);});
