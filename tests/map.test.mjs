import test from 'node:test';
import assert from 'node:assert/strict';
import {mapConfig} from '../lib/server/map-config.ts';
import {mapData,PIN_COLOURS} from '../lib/map-data.ts';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';

const view=(status,lat=6.8,lng=81.0,extra={})=>({key:'k',status,confidence:'high',placeId:'fixture_x_place',provider:'fixture',lat,lng,checkedAt:1,fixedBy:null,fixed:false,...extra});
const liveVenue=id=>({id,name:'Sample venue',address:'Ella',mapsUri:'',provider:'fixture',lat:6.8,lng:81});
const place=(key,group,v,extra={})=>({key,title:key,place:'Ella',group,view:v,...extra});
const ella={id:'r1',name:'Three days in Ella'},south={id:'r2',name:'South coast'};

test('key separation: the Places key is never served as the browser map key',()=>{
 const places='AIzaPLACES_server_only_0123456789',browser='AIzaBROWSER_public_maps_012345678';
 assert.deepEqual(mapConfig({GOOGLE_MAPS_BROWSER_KEY:browser,GOOGLE_PLACES_API_KEY:places,GOOGLE_MAPS_MAP_ID:'abc123'}),{browserKey:browser,mapId:'abc123'});
 assert.deepEqual(mapConfig({GOOGLE_MAPS_BROWSER_KEY:places,GOOGLE_PLACES_API_KEY:places}),{browserKey:null,mapId:'DEMO_MAP_ID',reason:'key_reused'});
 assert.equal(mapConfig({GOOGLE_PLACES_API_KEY:places}).browserKey,null,'a Places key alone never reaches the browser');
 assert.equal(mapConfig({}).reason,'not_configured');
 assert.equal(mapConfig({GOOGLE_MAPS_BROWSER_KEY:'bad key!'}).reason,'invalid_key');
 assert.equal(mapConfig({GOOGLE_MAPS_BROWSER_KEY:browser,GOOGLE_MAPS_MAP_ID:'<script>'}).mapId,'DEMO_MAP_ID');
});

test('map data: only matched places with a live location become pins, coloured by group',()=>{
 const data=mapData([
  place('cafe',ella,view('matched')),place('bridge',ella,view('matched',6.87,81.06,{confidence:'confirmed'})),
  place('kai',south,view('matched',5.97,80.36)),
  place('unavailable',ella,view('matched',null,null)),
  place('possible',ella,view('possible')),place('unmatched',south,view('unmatched',null,null)),place('unchecked',south,view('not_checked',null,null)),place('loading',south,null),
  place('unnamed',ella,view('not_a_venue',null,null)),place('notreal',ella,view('not_a_place',null,null)),
  place('bad',ella,view('matched',200,81)),
 ]);
 assert.deepEqual(data.pins.map(p=>p.key),['cafe','bridge','kai']);
 assert.equal(data.notOnMap,5,'unavailable, possible, unmatched, unchecked and invalid are "not on the map yet"; unnamed and not-real are not counted');
 assert.deepEqual(data.groups.map(g=>[g.name,g.colour]),[['Three days in Ella',PIN_COLOURS[0]],['South coast',PIN_COLOURS[1]]]);
 assert.equal(data.pins[2].colour,PIN_COLOURS[1]);
 assert.ok(Math.abs(data.centre.lat-(6.8+6.87+5.97)/3)<1e-9);
 assert.deepEqual(mapData([place('possible',ella,view('possible'))]),{pins:[],groups:[],notOnMap:1,centre:null});
});

test('drawPins: Advanced Markers in group colours, one click handler each, gentle camera with reduced motion',async()=>{
 // Run the real drawPins against a recording stand-in for google.maps.
 const {drawPins}=await exposed();
 const log=[],lib={
  Map:class{constructor(el,o){log.push(['map',o.mapId,o.gestureHandling]);}fitBounds(){log.push(['fit']);}setCenter(c){log.push(['center',c.lat]);}panTo(c){log.push(['pan',c.lat]);}setZoom(z){log.push(['zoom',z]);}},
  PinElement:class{constructor(o){this.element={colour:o.background};}},
  AdvancedMarkerElement:class{constructor(o){this.o=o;log.push(['marker',o.title,o.content.colour,o.gmpClickable]);}addListener(e,f){this.click=f;markers.push(this);}},
  LatLngBounds:class{extend(){}},
 },markers=[];
 const pins=[{key:'cafe',title:'Café Soul',lat:6.8,lng:81,colour:'#2f7258'},{key:'kai',title:'Kai',lat:5.9,lng:80.3,colour:'#b5532a'}],picked=[];
 drawPins(lib,{},pins,'DEMO_MAP_ID',k=>picked.push(k),true);
 assert.deepEqual(log.slice(0,3),[['map','DEMO_MAP_ID','cooperative'],['marker','Café Soul','#2f7258',true],['marker','Kai','#b5532a',true]]);
 assert.deepEqual(log[3],['fit']);
 markers[1].click();assert.deepEqual(picked,['kai']);assert.deepEqual(log.at(-1),['center',5.9],'reduced motion: no animated pan');
 drawPins(lib,{},pins,'DEMO_MAP_ID',()=>{},false);markers.at(-1).click();assert.equal(log.at(-1)[0],'pan');
});
function mods(extra={}){return {'@/lib/track':{track(){}},...extra};}
async function exposed(){const fs=await import('node:fs/promises'),ts=(await import('typescript')).default;const src=await fs.readFile(new URL('../components/bucket-map.tsx',import.meta.url),'utf8');
 // drawPins has no React or browser dependencies: evaluate it on its own.
 const start=src.indexOf('export function drawPins'),end=src.indexOf('\nexport type BucketMapPlace');
 const js=ts.transpileModule(src.slice(start,end),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import('data:text/javascript,'+encodeURIComponent(js));}

test('with no browser key the map opens as a grouped list with "Map not configured"',async()=>{
 const resolved={cafe:view('matched'),kai:view('matched',5.97,80.36),maybe:view('possible')};
 const real=await import('../lib/places-client.ts');
 const globals=browserGlobals();globals.fetch=async url=>{assert.equal(url,'/api/map-config');return Response.json({browserKey:null,mapId:'DEMO_MAP_ID',reason:'not_configured'});};
 globals.document.createElement=()=>{throw new Error('the Maps script must not load without a key');};
 const places=[{key:'cafe',title:'Café Soul',place:'Ella',group:ella},{key:'kai',title:'Kai',place:'Ahangama',group:south},{key:'maybe',title:'Maybe',place:'Ella',group:ella}];
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,resolvePlace:async p=>({...resolved[p.key],key:p.key}),venue:async id=>liveVenue(id)}})});
 await h.flush();
 assert.match(h.text(),/2 matched places · locations load when you open the map/);
 assert.doesNotMatch(h.text(),/Not configured/i,'nothing loads until the map is opened');
 h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();
 assert.match(h.text(),/2 places on the map · 1 place is not on the map yet/);
 assert.match(h.text(),/Map not configured yet/);assert.match(h.text(),/Three days in Ella/);assert.match(h.text(),/South coast/);
 assert.equal(h.elements(n=>n.type==='button'&&n.props['aria-pressed']!==undefined).length,2,'same pins as a list');
});

test('place_viewed counts a map selection, shares card deduplication, and separates buckets',async()=>{
 const real=await import('../lib/places-client.ts'),session=memoryStorage(),tracked=[];
 const render=async bucketId=>{
  const globals=browserGlobals({session});globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
  const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places:[{key:'cafe',title:'Café Soul',place:'Ella',group:ella}],bucketId,trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/track':{track:(...args)=>tracked.push(args)},'@/lib/places-client':{...real,resolvePlace:async()=>({...view('matched'),key:'cafe'}),venue:async id=>liveVenue(id)}})});
  await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();return h;
 };
 const h=await render('bucket-a');assert.deepEqual(tracked,[],'opening a map does not mean a place was inspected');
 const select=async h=>{h.elements(n=>n.type==='button'&&n.props['aria-pressed']!==undefined)[0].props.onClick();await h.flush();};
 await select(h);await select(h);await select(h);
 assert.deepEqual(tracked.map(([name,props,id])=>[name,props.placeId,id]),[['place_viewed','cafe','bucket-a']]);
 const cardGlobals=browserGlobals({session});
 const card=await componentHarness('components/place-match.tsx',{exportName:'PlaceMatch',globals:cardGlobals,props:{place:{key:'cafe',title:'Café Soul',place:'Ella'},bucketId:'bucket-a'},modules:mods({'@/lib/track':{track:(...args)=>tracked.push(args)},'@/lib/places-client':{...real,resolvePlace:async()=>({...view('matched'),key:'cafe'}),venue:async()=>({id:'fixture_x_place',name:'Café Soul',address:'Ella',mapsUri:'',provider:'fixture'})}})});
 await card.flush();card.elements(n=>n.type==='button'&&card.text(n)==='Show venue')[0].props.onClick();await card.flush();
 assert.equal(tracked.length,1,'the same place opened from the card is already counted');
 await select(await render('bucket-b'));
 assert.deepEqual(tracked.map(([name,props,id])=>[name,props.placeId,id]),[['place_viewed','cafe','bucket-a'],['place_viewed','cafe','bucket-b']]);
});

test('hand-off links record only partner and link type, show the before-you-book line, and the commission note only with a referral',async()=>{
 const tracked=[];
 const render=links=>componentHarness('components/bucket-map.tsx',{exportName:'HandoffLinks',props:{links,bucketId:'b1'},modules:mods({'@/lib/track':{track:(...a)=>tracked.push(a)}})});
 const plain=await render([{partner:'booking',partnerName:'Booking.com',label:'Find a place on Booking.com',url:'https://www.booking.com/searchresults.html?ss=Ella',linkType:'stay_search',referral:false}]);
 assert.match(plain.text(),/Check the total price and cancellation terms on Booking.com before you book\./);
 assert.doesNotMatch(plain.text(),/commission/);
 plain.elements(n=>n.type==='a')[0].props.onClick();
 assert.equal(JSON.stringify(tracked),JSON.stringify([['outbound_click',{provider:'booking',linkType:'stay_search'},'b1']]));
 const referred=await render([{partner:'getyourguide',partnerName:'GetYourGuide',label:'Find tours on GetYourGuide',url:'https://www.getyourguide.com/s/?q=x&partner_id=EXAMPLE_PARTNER',linkType:'activity_search',referral:true}]);
 assert.match(referred.text(),/may earn a commission/);assert.match(referred.elements(n=>n.type==='a')[0].props.rel,/sponsored/);
});

test('on a personal bucket the map respects this device’s fixes: "not a real place" is not a pin',async()=>{
 const real=await import('../lib/places-client.ts');
 const storage={getItem:k=>k===real.PLACE_FIXES_KEY?JSON.stringify({pool:{placeId:null,provider:null,notAPlace:true,fixedAt:1}}):null,setItem(){},removeItem(){}};
 const globals=browserGlobals({storage});
 const places=[{key:'cafe',title:'Café Soul',place:'Ella',group:ella},{key:'pool',title:'Ravana Pool Club',place:'Ella',group:ella}];
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,resolvePlace:async p=>({...view('matched'),key:p.key})}})});
 await h.flush();
 assert.match(h.text(),/1 matched place/);assert.doesNotMatch(h.text(),/not on the map yet/);
});

test('map locations load only on open, never use old response coordinates, and keep sources available after a failed lookup',async()=>{
 const real=await import('../lib/places-client.ts'),requested=[];let fail=true;
 const globals=browserGlobals();globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
 const places=[{key:'cafe',title:'Café Soul',place:'Ella',group:ella,source:{url:'https://www.instagram.com/reel/test/',creator:'creator'}}];
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,resolvePlace:async()=>view('matched',6.5,80),venue:async id=>{requested.push(id);if(fail)throw new Error('Venue details are unavailable.');return liveVenue(id);}}})});
 await h.flush();assert.deepEqual(requested,[],'opening a bucket does not fetch coordinates');
 const toggle=async label=>{h.elements(n=>n.type==='button'&&h.text(n)===label)[0].props.onClick();await h.flush();await h.flush();};
 await toggle('Show map');assert.equal(requested.length,1);
 assert.match(h.text(),/0 places on the map/);assert.match(h.text(),/Venue details are unavailable/);
 assert.match(h.text(),/Matched places without a map locationCafé Soul/);
 assert.equal(h.elements(n=>n.type==='a'&&h.text(n)==='Open reel')[0].props.href,places[0].source.url);
 assert.equal(h.elements(n=>n.type==='button'&&n.props['aria-pressed']!==undefined).length,0,'no fabricated or stale pin');
 fail=false;await toggle('Hide map');await toggle('Show map');
 assert.equal(requested.length,2);assert.match(h.text(),/1 place on the map/);assert.doesNotMatch(h.text(),/Venue details are unavailable/);
});
test('opening the map loads Google while venue coordinates are still pending',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals(),scripts=[];
 let finishVenue;const pending=new Promise(resolve=>{finishVenue=resolve;});
 globals.document.createElement=()=>({});globals.document.head={appendChild:script=>scripts.push(script)};
 globals.fetch=async()=>Response.json({browserKey:'test-browser-key',mapId:'DEMO_MAP_ID'});
 const places=[{key:'cafe',title:'Café Soul',place:'Ella',group:ella}];
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,resolvePlace:async()=>view('matched'),venue:()=>pending}})});
 await h.flush();assert.equal(scripts.length,0,'closed maps never load Google');
 h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();
 assert.equal(scripts.length,1,'Google loads before the slower coordinate lookup completes');
 assert.match(h.text(),/0 places on the map/);
 scripts[0].onerror();await h.flush();assert.match(h.text(),/Google Maps could not be loaded/);
 finishVenue(liveVenue('fixture_x_place'));await h.flush();h.unmount();
});

test('one pending venue does not block ready pins; a failed lookup stays explicit',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals(),requested=[];
 let rejectSlow;const slow=new Promise((_resolve,reject)=>{rejectSlow=reject;});
 globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
 const places=[{key:'fast',title:'Ready café',place:'Ella',group:ella},{key:'slow',title:'Slow café',place:'Ella',group:ella}];
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,
  resolvePlace:async p=>view('matched',null,null,{key:p.key,placeId:'fixture_'+p.key}),
  venue:id=>{requested.push(id);return id==='fixture_slow'?slow:Promise.resolve(liveVenue(id));}}})});
 await h.flush();assert.deepEqual(requested,[]);
 h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();
 assert.match(h.text(),/1 place on the map/);assert.match(h.text(),/Loading live map locations/);
 assert.equal(h.elements(n=>n.type==='button'&&n.props['aria-pressed']!==undefined).length,1);
 rejectSlow(new Error('Places took too long to respond.'));await h.flush();await h.flush();
 assert.match(h.text(),/1 place on the map/);assert.match(h.text(),/Places took too long/);
 assert.match(h.text(),/Matched places without a map locationSlow café/);
 assert.doesNotMatch(h.text(),/Loading live map locations/);
 assert.deepEqual(requested,['fixture_fast','fixture_slow']);h.unmount();
});

test('a failed place match is visible and cannot silently become an empty map',async()=>{
 const real=await import('../lib/places-client.ts'),places=[{key:'unavailable',title:'Café',place:'Ella',group:ella}],trip={start:null,end:null,travellers:2};let calls=0;
 const client={...real,resolvePlace:async()=>{calls++;throw new Error('Places took too long to respond.');}};
 for(const exportName of ['BucketMap','StayHandoff']){
  const h=await componentHarness('components/bucket-map.tsx',{exportName,props:{places,trip,fallbackArea:'Ella'},modules:mods({'@/lib/places-client':client})});
  await h.flush();assert.match(h.text(),/Places took too long to respond/);assert.match(h.text(),/Refresh to try matching again/);
  h.render();await h.flush();h.unmount();
 }
 assert.equal(calls,2,'failed requests are not retried by rerenders');
});

test('closing or unmounting the map ignores a pending venue response',async()=>{
 const real=await import('../lib/places-client.ts');
 for(const action of ['close','unmount']){
  const globals=browserGlobals();let finish,coordinateReads=0;
  const pending=new Promise(resolve=>{finish=resolve;});
  globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
  const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places:[{key:'cafe',title:'Café',place:'Ella',group:ella}],trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,resolvePlace:async()=>view('matched'),venue:()=>pending}})});
  await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();
  if(action==='close'){h.elements(n=>n.type==='button'&&h.text(n)==='Hide map')[0].props.onClick();await h.flush();}else h.unmount();
  finish({...liveVenue('fixture_x_place'),get lat(){coordinateReads++;return 7;}});await h.flush();await h.flush();
  assert.equal(coordinateReads,0,action+' must discard late coordinates before updating state');h.unmount();
 }
});

test('a stale coordinate response cannot overwrite the current bucket or revive a closed map',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals();let finishOld,requests=0;
 const old=new Promise(resolve=>{finishOld=resolve;});
 globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
 const places=[{key:'cafe',title:'Café',place:'Ella',group:ella}],trip={start:null,end:null,travellers:2};
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,bucketId:'old-bucket',trip},modules:mods({'@/lib/places-client':{...real,
  resolvePlace:async()=>view('matched'),venue:()=>++requests===1?old:Promise.resolve({...liveVenue('fixture_x_place'),lat:8})}})});
 await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();
 h.render({places,bucketId:'new-bucket',trip});await h.flush();await h.flush();
 h.elements(n=>n.type==='button'&&n.props['aria-pressed']!==undefined)[0].props.onClick();await h.flush();
 assert.equal(h.elements(n=>n.props?.pin)[0].props.pin.lat,8);
 finishOld({...liveVenue('fixture_x_place'),lat:7});await h.flush();await h.flush();
 assert.equal(h.elements(n=>n.props?.pin)[0].props.pin.lat,8,'old bucket response is ignored');
 assert.equal(requests,2,'scope changes do not request old-scope venues again');
 h.elements(n=>n.type==='button'&&h.text(n)==='Hide map')[0].props.onClick();await h.flush();
 assert.doesNotMatch(h.text(),/1 place on the map/);h.unmount();await h.flush();
 assert.equal(requests,2);
});

test('renaming a place at the same position withholds the previous venue while matching again',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals();let finish;
 const pending=new Promise(resolve=>{finish=resolve;});globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
 const places=[{key:'same-key',title:'Old venue',place:'Ella',group:ella}],trip={start:null,end:null,travellers:2};
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip},modules:mods({'@/lib/places-client':{...real,resolvePlace:p=>p.title==='Old venue'?Promise.resolve(view('matched')):pending,venue:async id=>liveVenue(id)}})});
 await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();assert.match(h.text(),/1 place on the map/);
 h.render({places:[{...places[0],title:'Different venue'}],trip});await h.flush();assert.match(h.text(),/0 places on the map/);
 assert.equal(h.elements(n=>n.type==='button'&&n.props['aria-pressed']!==undefined).length,0,'a new title never labels an old venue pin');
 finish(view('unmatched',null,null,{placeId:null}));await h.flush();assert.match(h.text(),/0 places on the map/);h.unmount();
});

test('an open map survives polling and votes without another map load or camera reset',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals();
 const maps=[],markers=[],camera=[];
 const lib={Map:class{constructor(){maps.push(this);}fitBounds(){camera.push('fit');}setCenter(){camera.push('center');}panTo(){}setZoom(){camera.push('zoom');}},
  PinElement:class{element={};},AdvancedMarkerElement:class{constructor(options){this.map=options.map;markers.push(this);}addListener(){}},LatLngBounds:class{extend(){}}};
 globals.window.google={maps:{importLibrary:async()=>lib}};
 globals.fetch=async()=>Response.json({browserKey:'test-browser-key',mapId:'DEMO_MAP_ID'});
 const places=[{key:'cafe',title:'Café Soul',place:'Ella',group:ella,up:0}],trip={start:null,end:null,travellers:2};
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip},modules:mods({'@/lib/places-client':{...real,resolvePlace:async()=>view('matched'),venue:async id=>liveVenue(id)}})});
 await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();
 h.elements(n=>n.props?.className==='map-canvas')[0].props.ref.current={};
 h.render({places:places.map(p=>({...p})),trip});await h.flush();await h.flush();
 assert.equal(maps.length,1);const moves=camera.length;
 for(let i=1;i<=3;i++){h.render({places:places.map(p=>({...p,up:i})),trip});await h.flush();await h.flush();}
 assert.equal(maps.length,1,'polling and votes do not create billable map instances');
 assert.equal(camera.length,moves,'polling preserves the person’s camera position');
 h.render({places:places.map(p=>({...p,title:'Café Soul updated'})),trip});await h.flush();await h.flush();
 assert.equal(maps.length,1,'changed pins reuse the existing map');
 assert.equal(markers[0].map,null,'replaced markers are detached');
 h.render({places:[],trip});await h.flush();await h.flush();
 assert.equal(markers.at(-1).map,null,'removing the last place leaves no stale pin');
 assert.equal(maps.length,1);
});

test('a later pin does not reset the camera after the person interacts with the map',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals(),camera=[],maps=[],markers=[];let finish;
 const slow=new Promise(resolve=>{finish=resolve;});
 const lib={Map:class{constructor(){maps.push(this);}fitBounds(){camera.push('fit');}setCenter(){camera.push('center');}panTo(){}setZoom(){camera.push('zoom');}},
  PinElement:class{element={};},AdvancedMarkerElement:class{constructor(options){this.map=options.map;markers.push(this);}addListener(){}},LatLngBounds:class{extend(){}}};
 globals.window.google={maps:{importLibrary:async()=>lib}};
 globals.fetch=async()=>Response.json({browserKey:'test-browser-key',mapId:'DEMO_MAP_ID'});
 const places=[{key:'fast',title:'Ready café',place:'Ella',group:ella},{key:'slow',title:'Slow café',place:'Ella',group:ella}],trip={start:null,end:null,travellers:2};
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places,trip},modules:mods({'@/lib/places-client':{...real,
  resolvePlace:async p=>view('matched',null,null,{key:p.key,placeId:'fixture_'+p.key}),venue:id=>id==='fixture_slow'?slow:Promise.resolve(liveVenue(id))}})});
 await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();
 const canvas=h.elements(n=>n.props?.className==='map-canvas')[0];canvas.props.ref.current={};
 h.render({places:places.map(p=>({...p})),trip});await h.flush();await h.flush();assert.equal(maps.length,1);assert.ok(camera.length>0);
 canvas.props.onPointerDown();const initialMoves=camera.length;
 finish({...liveVenue('fixture_slow'),lat:8});await h.flush();await h.flush();
 assert.match(h.text(),/2 places on the map/);assert.equal(markers.filter(m=>m.map!==null).length,2);
 assert.equal(camera.length,initialMoves,'late results preserve the user’s view');assert.equal(maps.length,1);h.unmount();
});

test('a venue correction updates the open map immediately and stays scoped to its bucket',async()=>{
 const real=await import('../lib/places-client.ts'),globals=browserGlobals();let status='possible';
 globals.fetch=async()=>Response.json({browserKey:null,mapId:'DEMO_MAP_ID'});
 const h=await componentHarness('components/bucket-map.tsx',{exportName:'BucketMap',globals,props:{places:[{key:'bridge',title:'Nine Arch Bridge',place:'Ella',group:ella}],bucketId:'test-bucket',trip:{start:null,end:null,travellers:2}},modules:mods({'@/lib/places-client':{...real,resolvePlace:async()=>view(status),venue:async id=>liveVenue(id)}})});
 await h.flush();h.elements(n=>n.type==='button'&&h.text(n)==='Show map')[0].props.onClick();await h.flush();await h.flush();
 assert.match(h.text(),/0 places on the map/);status='matched';
 globals.window.dispatchEvent(new CustomEvent('reeltrip:place-updated',{detail:{key:'bridge',bucketId:'another-bucket'}}));await h.flush();assert.match(h.text(),/0 places on the map/);
 globals.window.dispatchEvent(new CustomEvent('reeltrip:place-updated',{detail:{key:'bridge',bucketId:'test-bucket'}}));await h.flush();await h.flush();
 assert.match(h.text(),/1 place on the map/);
});
