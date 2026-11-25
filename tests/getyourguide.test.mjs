import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AMSTERDAM_CRUISE,getYourGuideActivity,getYourGuideActivityUrl,getYourGuideEmbed,activitySearchUrl} from '../lib/getyourguide.ts';
test('only individual GetYourGuide activities can supply a calendar ID',()=>{
 assert.equal(getYourGuideActivity(AMSTERDAM_CRUISE+'?ranking_uuid=example')?.id,'907734');
 for(const bad of ['https://www.getyourguide.com/en-gb/amsterdam-l36/','https://getyourguide.com.evil.test/trip-t907734/','https://www.getyourguide.com@evil.test/trip-t907734/','https://evil.test/trip-t907734/','javascript:alert(1)','https://www.getyourguide.com:444/trip-t907734/'])assert.equal(getYourGuideActivity(bad),null);
});
test('activity booking links preserve the selected date and adults without session tracking',()=>{
 const url=new URL(getYourGuideActivityUrl(AMSTERDAM_CRUISE+'?visitor_id=private&date_from=2000-01-01','2099-12-22',4));
 assert.equal(url.searchParams.get('date_from'),'2099-12-22');assert.equal(url.searchParams.get('_pc'),'1,4');assert.equal(url.searchParams.get('partner_id'),'EXAMPLE_PARTNER');assert.equal(url.searchParams.has('visitor_id'),false);
 const invalid=new URL(getYourGuideActivityUrl(AMSTERDAM_CRUISE,'2099-02-30',0));assert.equal(invalid.searchParams.has('date_from'),false);assert.equal(invalid.searchParams.has('_pc'),false);
});
test('Amsterdam browse links retain verified category and date filters',()=>{
 const u=new URL(activitySearchUrl('Amsterdam',{boats:true,kids:true},'2099-12-22','2099-12-23'));
 assert.equal(u.pathname,'/en-gb/amsterdam-l36/');assert.equal(u.searchParams.get('interestFilters'),'tc-48,tc-1094');assert.equal(u.searchParams.get('date_from'),'2099-12-22');assert.equal(u.searchParams.get('date_to'),'2099-12-23');
 const other=new URL(activitySearchUrl('Ella & cafés',{boats:false,kids:true}));assert.equal(other.searchParams.get('q'),'Ella & cafés family friendly');assert.equal(other.searchParams.has('interestFilters'),false);
});
test('provider embeds escape untrusted reel text and never accept arbitrary script or frame URLs',()=>{
 const html=getYourGuideEmbed({query:'"><script>alert(1)</script><img src=x onerror=alert(2)>',currency:'"><script>'});
 assert.equal((html.match(/<script/g)||[]).length,1);assert.equal(html.includes('<img'),false);assert.match(html,/&lt;script&gt;/);assert.match(html,/widget.getyourguide.com\/dist\/pa.umd.production.min.js/);
 const calendar=getYourGuideEmbed({activityUrl:AMSTERDAM_CRUISE,currency:'GBP'});assert.match(calendar,/data-gyg-tour-id="907734"/);assert.match(calendar,/data-gyg-currency="GBP"/);
 assert.throws(()=>getYourGuideEmbed({activityUrl:'https://evil.test/tour-t1/'}));
});
