import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';
import {activityExplorerUrl} from '../lib/activity-context.ts';
import {prepareSpecialists,specialistDestinationLinks} from '../lib/booking-specialists.ts';
import {itemForProviderLink,interestKey} from '../lib/interested.ts';
import {AMSTERDAM_CRUISE} from '../lib/getyourguide.ts';

const preferences={name:'Holiday ideas',destination:'',dates:[{start:'2099-01-02',end:'2099-01-05'}],activeDate:0,adults:2,currency:'EUR',brief:''};
const trip={id:'11111111-1111-4111-8111-111111111111',...preferences,bundleIds:[],reelIds:[],interestIds:[],createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:00Z'};
async function explorer(url,activeTrip=trip){
 const sources={reels:[],bundles:[],error:''};
 const modules={'@/components/trip-buckets':{useTrips:()=>({ready:true,activeId:activeTrip?.id||null,activeTrip,error:'',update:()=>true})},'@/components/use-trip-sources':{useTripSources:()=>sources}};
 const page=await componentHarness('app/activities/page.tsx',{modules,globals:browserGlobals({search:new URL(url,'https://reeltrip.test').search})});
 const element=page.elements(node=>node.type?.name==='ActivityExplorer')[0];
 assert.ok(element);page.unmount();
 return componentHarness('app/activities/page.tsx',{modules,expose:['ActivityExplorer'],exportName:'ActivityExplorer',props:element.props});
}
const options=h=>h.elements(node=>node.type?.displayName==='GetYourGuideOptions');

test('unknown saved-activity location stays unknown through preparation and the real explorer',async()=>{
 const input=itemForProviderLink(AMSTERDAM_CRUISE,'Saved activity');
 const item={...input,id:interestKey(input),addedAt:'2026-11-20T00:00:00Z'};
 const card=prepareSpecialists({analyses:[],interests:[item],preferences})[0];
 assert.equal(card.status,'Shortlisted');assert.match(card.missing.join(' '),/city or area/);
 const link=card.links.find(link=>link.url.startsWith('/activities?'));
 assert.equal(new URL(link.url,'https://reeltrip.test').searchParams.get('destination'),'');
 const h=await explorer(link.url);
 assert.equal(h.elements(node=>node.props?.['aria-label']==='Activity destination')[0].props.value,'');
 assert.equal(options(h).length,0);assert.match(h.text(),/Location to confirm/);assert.doesNotMatch(h.text(),/Amsterdam|From your reel/);
 h.elements(node=>node.props?.['aria-label']==='Activity destination')[0].props.onChange({target:{value:'Ella'}});h.render();
 assert.equal(options(h)[0].props.query,'Ella Saved activity');h.unmount();
});

test('destination searches and saved-choice links cannot claim reel provenance',async()=>{
 const link=specialistDestinationLinks('activity',{...preferences,destination:'Ella'})[0].url;
 const h=await explorer(link,{...trip,destination:'Ella'});
 assert.match(h.text(),/Selected activity: Ella activities/);assert.doesNotMatch(h.text(),/From your reel/);
 assert.equal(options(h)[0].props.query,'Ella');h.unmount();
 const reel=await explorer(activityExplorerUrl({title:'Waterfalls by tuk-tuk',query:'Ella waterfalls',place:'Ella'}));
 assert.match(reel.text(),/Selected activity: Waterfalls by tuk-tuk/);assert.equal(options(reel)[0].props.query,'Ella waterfalls');reel.unmount();
});

test('a blank standalone explorer asks for a destination without a preselected example',async()=>{
 const h=await explorer('/activities',null);
 assert.equal(options(h).length,0);assert.match(h.text(),/Choose a city or area/);assert.doesNotMatch(h.text(),/Amsterdam/);h.unmount();
});

test('GetYourGuide distinguishes provider-controlled suggestion currency from the configured calendar',async()=>{
 const props={query:'Ella waterfalls',currency:'EUR',initialActivity:AMSTERDAM_CRUISE};
 const h=await componentHarness('components/getyourguide-options.tsx',{props});
 assert.match(h.text(),/suggestions use GetYourGuide’s currency.*selected EUR/);
 h.elements(node=>node.type==='button'&&h.text(node)==='Show GetYourGuide options')[0].props.onClick();h.render();
 const suggestions=h.elements(node=>node.type==='iframe')[0].props.srcDoc;
 h.render({...props,currency:'GBP'});
 assert.match(h.text(),/selected GBP/);assert.equal(h.elements(node=>node.type==='iframe')[0].props.srcDoc,suggestions);
 h.elements(node=>node.type==='button'&&h.text(node)==='Preview availability calendar')[0].props.onClick();h.render();
 assert.match(h.elements(node=>node.type==='iframe')[0].props.srcDoc,/data-gyg-currency="GBP"/);
 h.render({...props,currency:'EUR'});
 assert.match(h.elements(node=>node.type==='iframe')[0].props.srcDoc,/data-gyg-currency="EUR"/);h.unmount();
});
