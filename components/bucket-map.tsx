'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,BedDouble,Map as MapIcon,MapPin,ThumbsDown,ThumbsUp} from 'lucide-react';
import {resolvePlace,placeInputKey,venue,timestamp,personalFixes,withPersonalFix,type PlaceInput,type PlaceView,type Venue} from '@/lib/places-client';
import {mapData,type MapPlaceInput,type Pin} from '@/lib/map-data';
import {placeLinks,stayLinks,stayArea,tripDates,beforeYouBook,COMMISSION_NOTE,type HandoffLink,type PlaceForLinks,type Trip} from '@/lib/handoff';
import {track} from '@/lib/track';
import {firstPlaceView} from '@/lib/place-views';

// Partner links that say where they go, carry no prices, and record only the
// partner and link type when used.
export function HandoffLinks({links,bucketId}:{links:HandoffLink[];bucketId?:string}){
 if(!links.length)return null;
 const partners=[...new Set(links.map(l=>l.partnerName))];
 return <div className="handoff">
  <div className="handoff-links">{links.map(link=><a key={link.url} className="provider-link" href={link.url} target="_blank" rel={link.referral?'noopener noreferrer sponsored':'noopener noreferrer'} onClick={()=>track('outbound_click',{provider:link.partner,linkType:link.linkType},bucketId)}>{link.label}<ArrowUpRight size={13} aria-hidden="true"/></a>)}</div>
  <p className="handoff-note">{partners.map(beforeYouBook).join(' ')}</p>
  {links.some(l=>l.referral)&&<p className="affiliate-note">{COMMISSION_NOTE}</p>}
 </div>;
}

// Matches for a set of places, shared by the map and the stay hand-off (cached per page).
export function usePlaceViews(places:PlaceInput[],bucketId?:string){
 const placeKey=JSON.stringify(places.map(placeInputKey));
 const [snapshot,setSnapshot]=useState<{bucketId?:string;placeKey:string;views:Record<string,PlaceView|null>;error:string}>({bucketId,placeKey,views:{},error:''});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  const changed=(event:Event)=>{const detail=(event as CustomEvent<{key:string;bucketId?:string}>).detail;if(detail?.bucketId===bucketId&&places.some(p=>p.key===detail.key))setRevision(v=>v+1);};
  window.addEventListener('reeltrip:place-updated',changed);return ()=>window.removeEventListener('reeltrip:place-updated',changed);
 },[placeKey,bucketId]);
 useEffect(()=>{let live=true,error='';Promise.all(places.map(p=>resolvePlace(p,bucketId).catch(e=>{error=(e as Error).message;return null;}))).then(list=>{
  // Outside a shared bucket, this device's own fixes apply (a fixed venue has no stored location).
  let fixes:ReturnType<typeof personalFixes>={};if(!bucketId){try{fixes=personalFixes(localStorage);}catch{}}
  if(live)setSnapshot({bucketId,placeKey,views:Object.fromEntries(places.map((p,i)=>[p.key,list[i]?withPersonalFix(list[i]!,fixes[p.key]):null])),error});});return ()=>{live=false;};},[placeKey,bucketId,revision]);
 return snapshot.bucketId===bucketId&&snapshot.placeKey===placeKey?snapshot:{views:EMPTY_VIEWS,error:''};
}
const EMPTY_VIEWS:Record<string,PlaceView|null>={};
// "Find a place to stay" searches around the most common place named by the matched places.
export function StayHandoff({places,fallbackArea,trip,bucketId}:{places:PlaceInput[];fallbackArea:string;trip:Trip;bucketId?:string}){
 const {views,error}=usePlaceViews(places,bucketId);
 const area=stayArea(places.filter(p=>views[p.key]?.status==='matched'),fallbackArea);
 const links=stayLinks(area,trip);
 return <section className="stay-handoff" aria-labelledby="stay-handoff-heading">
  <h2 id="stay-handoff-heading"><BedDouble size={19} aria-hidden="true"/>Find a place to stay</h2>
  {error&&<p className="inline-message" role="status">{error} Refresh to try matching again.</p>}
  <p>{area?<>Stays in <strong>{area}</strong></>:'Add a place to choose an area'} · {tripDates(trip.start,trip.end)} · {trip.travellers} {trip.travellers===1?'traveller':'travellers'}</p>
  {links.length?<HandoffLinks links={links} bucketId={bucketId}/>:<p className="fine-print">Add a place to the bucket to search for stays nearby.</p>}
 </section>;
}

// Load Google's Maps JavaScript API once, only when the map is opened.
let loading:Promise<GoogleMaps>|null=null;
type GoogleMaps={importLibrary(name:string):Promise<Record<string,unknown>>};
export function loadMaps(key:string):Promise<GoogleMaps>{
 const w=window as unknown as {google?:{maps?:GoogleMaps};__reeltripMapsReady?:()=>void};
 if(w.google?.maps)return Promise.resolve(w.google.maps);
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  w.__reeltripMapsReady=()=>w.google?.maps?resolve(w.google.maps):reject(new Error('Google Maps did not load.'));
  const script=document.createElement('script');
  script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,v:'weekly',loading:'async',libraries:'marker',callback:'__reeltripMapsReady'});
  script.async=true;script.onerror=()=>{loading=null;reject(new Error('Google Maps could not be loaded.'));};
  document.head.appendChild(script);
 });
 return loading;
}
type MapsLib={Map:new(el:HTMLElement,opts:Record<string,unknown>)=>{fitBounds(b:unknown,padding?:number):void;setCenter(c:unknown):void;panTo(c:unknown):void;setZoom(z:number):void};AdvancedMarkerElement:new(opts:Record<string,unknown>)=>{map:unknown|null;addListener(e:string,f:()=>void):void};PinElement:new(opts:Record<string,unknown>)=>{element:unknown};LatLngBounds:new()=>{extend(p:unknown):void}};
type DrawnMap={map:InstanceType<MapsLib['Map']>;markers:InstanceType<MapsLib['AdvancedMarkerElement']>[];signature:string;onSelect:(key:string)=>void};
// Draws pins as Advanced Markers coloured by group. Google's logo and data
// attribution stay on the map; nothing is placed over them.
export function drawPins(lib:MapsLib,el:HTMLElement,pins:Pin[],mapId:string,onSelect:(key:string)=>void,reducedMotion:boolean,previous?:DrawnMap,preserveCamera=false){
 // Votes and background refreshes must not reload the map or reset its camera.
 const signature=JSON.stringify(pins.map(p=>[p.key,p.title,p.lat,p.lng,p.colour]));
 if(previous?.signature===signature&&previous.onSelect===onSelect)return previous;
 const map=previous?.map??new lib.Map(el,{mapId,gestureHandling:'cooperative',clickableIcons:false,streetViewControl:false,mapTypeControl:false,fullscreenControl:true});
 previous?.markers.forEach(marker=>{marker.map=null;});
 const markers:DrawnMap['markers']=[];
 const bounds=new lib.LatLngBounds();
 for(const pin of pins){
  const glyph=new lib.PinElement({background:pin.colour,borderColor:'#ffffff',glyphColor:'#ffffff'});
  const marker=new lib.AdvancedMarkerElement({map,position:{lat:pin.lat,lng:pin.lng},title:pin.title,content:glyph.element,gmpClickable:true});
  markers.push(marker);
  marker.addListener('click',()=>{onSelect(pin.key);if(reducedMotion)map.setCenter({lat:pin.lat,lng:pin.lng});else map.panTo({lat:pin.lat,lng:pin.lng});});
  bounds.extend({lat:pin.lat,lng:pin.lng});
 }
 if(!preserveCamera||!previous){if(pins.length>1)map.fitBounds(bounds,48);else if(pins.length===1){map.setCenter({lat:pins[0].lat,lng:pins[0].lng});map.setZoom(14);}}
 return {map,markers,signature,onSelect};
}

export type BucketMapPlace=PlaceInput&{group:{id:string;name:string};up?:number;down?:number;source?:{url:string;creator?:string;second?:number}};
export function BucketMap({places,bucketId,trip}:{places:BucketMapPlace[];bucketId?:string;trip:Trip}){
 const {views,error:matchError}=usePlaceViews(places,bucketId);
 const [open,setOpen]=useState(false),[config,setConfig]=useState<{browserKey:string|null;mapId:string}|null>(null),[selected,setSelected]=useState<string|null>(null),[mapError,setMapError]=useState('');
 const [locations,setLocations]=useState<Record<string,Pick<Venue,'lat'|'lng'>>>({}),[locating,setLocating]=useState(false),[locationError,setLocationError]=useState('');
 // Fit arriving pins until the person navigates; late results must preserve their view.
 const cameraInteracted=useRef(false);
 const selectPlace=useCallback((key:string|null)=>{if(key)cameraInteracted.current=true;setSelected(key);if(key&&firstPlaceView(window,key,bucketId))track('place_viewed',{placeId:key},bucketId);},[bucketId]);
 const mapEl=useRef<HTMLDivElement>(null);
 const renderedMap=useRef<{element:HTMLElement;mapId:string;drawing:DrawnMap}|null>(null);
 const data=useMemo(()=>mapData(places.map(p=>{const view=views[p.key];return {...p,view:view?{...view,...(locations[view.placeId||'']||{lat:null,lng:null})}:null} as MapPlaceInput;})),[places,views,locations]);
 const matched=places.filter(p=>views[p.key]?.status==='matched'),missingLocations=matched.filter(p=>!data.pins.some(pin=>pin.key===p.key));
 useEffect(()=>{cameraInteracted.current=false;},[bucketId,open]);
 // Fetch coordinates only for an opened map; venue cards reuse these live details.
 useEffect(()=>{
  if(!open)return;let live=true;setLocating(true);setLocationError('');setLocations({});
  const ids=[...new Set(Object.values(views).filter(v=>v?.status==='matched'&&v.placeId).map(v=>v!.placeId!))];
  let pending=ids.length;if(!pending)setLocating(false);
  // Ready places appear immediately; another venue's slow response must not hold every pin back.
  ids.forEach(id=>{void venue(id).then(details=>{if(live)setLocations(current=>({...current,[id]:{lat:details.lat,lng:details.lng}}));})
   .catch(error=>{if(live)setLocationError((error as Error).message);})
   .finally(()=>{if(live&&--pending===0)setLocating(false);});});
  return ()=>{live=false;};
 },[open,views,bucketId]);
 // Only after the person opens the map: fetch the public map settings, then load Google.
 useEffect(()=>{if(!open||config)return;let live=true;fetch('/api/map-config').then(r=>r.json() as Promise<{browserKey?:unknown;mapId?:unknown}>).then(c=>{
  if(live)setConfig({browserKey:typeof c.browserKey==='string'?c.browserKey:null,mapId:String(c.mapId||'DEMO_MAP_ID')});
 }).catch(()=>{if(live)setConfig({browserKey:null,mapId:'DEMO_MAP_ID'});});return ()=>{live=false;};},[open,config]);
 // Load Google's script in parallel with coordinates, still only on map open.
 useEffect(()=>{if(!open||!config?.browserKey)return;let live=true;setMapError('');
  void loadMaps(config.browserKey).catch(e=>{if(live)setMapError((e as Error).message);});
  return ()=>{live=false;};
 },[open,config?.browserKey]);
 useEffect(()=>{
  if(!open){renderedMap.current?.drawing.markers.forEach(marker=>{marker.map=null;});renderedMap.current=null;return;}
  if(!config?.browserKey||!mapEl.current||(!data.pins.length&&!renderedMap.current))return;
  let live=true;const element=mapEl.current;
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
  loadMaps(config.browserKey).then(async maps=>{const [core,marker,mapsLib]=await Promise.all([maps.importLibrary('core'),maps.importLibrary('marker'),maps.importLibrary('maps')]);
   if(!live||mapEl.current!==element)return;
   const previous=renderedMap.current;
   const drawing=drawPins({...core,...mapsLib,...marker} as unknown as MapsLib,element,data.pins,config.mapId,selectPlace,reduced,previous?.element===element&&previous.mapId===config.mapId?previous.drawing:undefined,cameraInteracted.current);
   renderedMap.current={element,mapId:config.mapId,drawing};
  }).catch(e=>{if(live)setMapError((e as Error).message);});
  return ()=>{live=false;};
 },[open,config,data.pins,selectPlace]);
 const pin=data.pins.find(p=>p.key===selected),place=places.find(p=>p.key===selected);
 const showMap=!!config?.browserKey&&!mapError;
 return <section className="bucket-map" aria-labelledby="bucket-map-heading">
  <div className="bucket-map-head"><h2 id="bucket-map-heading"><MapIcon size={19} aria-hidden="true"/>Map of your places</h2>
   <button type="button" className="secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide map':'Show map'}</button></div>
  {matchError&&<p className="inline-message" role="status">{matchError} Refresh to try matching again.</p>}
  <p className="fine-print">{open?<>{data.pins.length} {data.pins.length===1?'place':'places'} on the map{data.notOnMap>0&&<> · {data.notOnMap} {data.notOnMap===1?'place is':'places are'} not on the map yet</>}</>:<>{matched.length} matched {matched.length===1?'place':'places'} · locations load when you open the map</>}</p>
  {open&&<>
   {locating&&<p role="status">Loading live map locations…</p>}
   {locationError&&<p className="inline-message" role="status">{locationError} Reel sources remain below. Close and reopen the map to try again.</p>}
   {data.groups.length>0&&<ul className="map-legend" aria-label="Pin colours">{data.groups.map(g=><li key={g.id}><span className="map-swatch" style={{background:g.colour}} aria-hidden="true"/>{g.name}</li>)}</ul>}
   {config===null?<p role="status">Opening the map…</p>:showMap?<div ref={mapEl} className="map-canvas" role="region" onPointerDown={()=>{cameraInteracted.current=true;}} onWheel={()=>{cameraInteracted.current=true;}} onKeyDown={()=>{cameraInteracted.current=true;}} aria-label="Map of matched places. Use the list below if you prefer."/>:
    <p className="inline-message">{mapError||'Map not configured yet.'} Here are the same places, grouped by {bucketId?'reel':'bundle'}.</p>}
   <div className="map-list">{data.groups.map(g=><div key={g.id}><h3><span className="map-swatch" style={{background:g.colour}} aria-hidden="true"/>{g.name}</h3>
    <ul>{data.pins.filter(p=>p.groupId===g.id).map(p=><li key={p.key}><button type="button" aria-pressed={selected===p.key} onClick={()=>selectPlace(selected===p.key?null:p.key)}><MapPin size={14} aria-hidden="true"/>{p.title}</button></li>)}</ul></div>)}
    {!locating&&missingLocations.length>0&&<div><h3>Matched places without a map location</h3><ul>{missingLocations.map(p=><li key={p.key}>{p.title}{p.source&&<> · <a href={p.source.url} target="_blank" rel="noopener noreferrer">Open reel</a></>}</li>)}</ul></div>}
    {!locating&&!data.pins.length&&<p className="fine-print">No matched places with a location available.</p>}</div>
   {pin&&place&&<PinCard pin={pin} place={place} trip={trip} bucketId={bucketId} onClose={()=>setSelected(null)}/>}
  </>}
 </section>;
}

function PinCard({pin,place,trip,bucketId,onClose}:{pin:Pin;place:BucketMapPlace;trip:Trip;bucketId?:string;onClose:()=>void}){
 const [details,setDetails]=useState<Venue|null>(null),[error,setError]=useState('');
 // The venue's name and Maps link are fetched live and never stored.
 useEffect(()=>{setDetails(null);setError('');if(!pin.placeId)return;let live=true;venue(pin.placeId).then(v=>{if(live)setDetails(v);}).catch(e=>{if(live)setError((e as Error).message);});return ()=>{live=false;};},[pin.placeId]);
 const links=placeLinks(place as unknown as PlaceForLinks,trip);
 return <div className="pin-card" role="dialog" aria-label={place.title}>
  <div className="pin-card-head"><div><strong>{details?.name||place.title}</strong>{details&&<span>{details.address}</span>}{error&&<span role="alert">{error}</span>}</div><button type="button" className="text-button" onClick={onClose} aria-label="Close place card">Close</button></div>
  {details&&(details.provider==='fixture'?<span className="place-attribution">Sample data · not a real listing</span>:<a className="place-attribution" href={details.mapsUri||undefined} target="_blank" rel="noopener noreferrer">Google Maps<ArrowUpRight size={12} aria-hidden="true"/></a>)}
  <p className="pin-card-from">From the reel: {place.title}{place.source?.creator&&<> · @{place.source.creator.replace(/^@/,'')}</>}{place.source?.second!==undefined&&<> at {timestamp(place.source.second)}</>}</p>
  {pin.up!==undefined&&<p className="pin-card-votes"><ThumbsUp size={13} aria-hidden="true"/>{pin.up} keep · <ThumbsDown size={13} aria-hidden="true"/>{pin.down} skip</p>}
  {place.source&&<a className="secondary" href={place.source.url} target="_blank" rel="noopener noreferrer">Open reel<ArrowUpRight size={13} aria-hidden="true"/></a>}
  <HandoffLinks links={links} bucketId={bucketId}/>
 </div>;
}
