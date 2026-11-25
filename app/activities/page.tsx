'use client';
import {useEffect,useState} from 'react';
import {BucketNavigation,WorkspaceHeader} from '@/components/workspace-navigation';
import {GetYourGuideOptions} from '@/components/getyourguide-options';
import {ViatorSearch} from '@/components/viator-results';
import {activityLocations,activitySearchQuery,activityTermsAfterLocationChange,readActivityContext,type ActivityContext} from '@/lib/activity-context';
import type {Match} from '@/lib/travel';
import {useTrips} from '@/components/trip-buckets';
import {getTripReels,type TripBucket,type TripPatch} from '@/lib/trip-buckets';
import {useTripSources} from '@/components/use-trip-sources';
import {ANALYSIS_KEY,readAnalysisCache,type AnalysisCache} from '@/lib/analysis-cache';
import {tripAnalysisRows} from '@/lib/trip-planning';

type InitialActivity={selection:ActivityContext;hasSearchContext:boolean;bucketId:string|null};

export default function ActivitiesPage(){
 const trips=useTrips(),[initial,setInitial]=useState<InitialActivity|null>(null);
 const sources=useTripSources(),[cache,setCache]=useState<AnalysisCache>({});
 useEffect(()=>{
  const refresh=()=>{try{setCache(readAnalysisCache(localStorage.getItem(ANALYSIS_KEY),sources.reels));}catch{setCache({});}};
  const storage=(event:StorageEvent)=>{if(event.key===null||event.key===ANALYSIS_KEY)refresh();};
  refresh();window.addEventListener('reeltrip:analysis-changed',refresh);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener('reeltrip:analysis-changed',refresh);window.removeEventListener('storage',storage);};
 },[sources.reels]);
 useEffect(()=>{
  if(!trips.ready||initial)return;
  const params=new URLSearchParams(window.location.search);
  setInitial({selection:readActivityContext(params),hasSearchContext:['destination','q','title'].some(key=>params.has(key)),bucketId:trips.activeId});
 },[trips.ready,trips.activeId,initial]);
 const resolved=trips.activeTrip?getTripReels(trips.activeTrip,sources.bundles,sources.reels):null;
 const sourcePlaces=!sources.error&&!resolved?.overLimit?tripAnalysisRows(resolved?.reels||[],cache).flatMap(row=>row.analysis?.matches||[]):[];
 return <div className="reel-app"><WorkspaceHeader active="activities"/><BucketNavigation active="activities" trip={trips.activeTrip} ready={trips.ready} error={trips.error}/><main className="reservation-examples activity-explorer">
  {initial&&trips.ready?<ActivityExplorer key={trips.activeId||'unassigned'} trip={trips.activeTrip} locations={activityLocations(sourcePlaces,trips.activeTrip?.destination)} initial={initial.bucketId===trips.activeId?initial:undefined} onPreferences={patch=>trips.activeTrip?trips.update(trips.activeTrip.id,patch):false}/>:<p role="status">Loading activity search…</p>}
 </main></div>;
}

function ActivityExplorer({trip,locations,initial,onPreferences}:{trip:TripBucket|null;locations:string[];initial?:InitialActivity;onPreferences:(patch:TripPatch)=>boolean}){
 const [selection,setSelection]=useState(()=>{
  const context=initial?.selection||readActivityContext(new URLSearchParams());
  return trip&&!initial?.hasSearchContext?{...context,destination:trip.destination,query:trip.destination,title:''}:context;
 });
 const [provider,setProvider]=useState('GetYourGuide');
 const [location,setLocation]=useState(''),[customLocation,setCustomLocation]=useState('');
 const [locationNotice,setLocationNotice]=useState('');
 const {destination,query,title}=selection;
 const {start,end}=trip?.dates[trip.activeDate]||selection;
 const adults=trip?.adults||selection.adults,currency=trip?.currency||selection.currency;
 function update(values:Partial<ActivityContext>){
  if(trip){
   const patch:TripPatch={};
   if(values.start!==undefined||values.end!==undefined)patch.dates=trip.dates.map((date,index)=>index===trip.activeDate?{start:values.start??date.start,end:values.end??date.end}:date);
   if(values.adults!==undefined)patch.adults=values.adults;
   if(values.currency!==undefined)patch.currency=values.currency;
   if(Object.keys(patch).length&&!onPreferences(patch))return;
  }
  setSelection(previous=>({...previous,...values}));
 }
 const chosenLocation=location==='custom'?customLocation:location||destination;
 function changeLocation(next:string,values:Partial<ActivityContext>={}){
  const nextQuery=activityTermsAfterLocationChange(query,chosenLocation,next,!!title);
  if(query&&nextQuery!==query)setLocationNotice('The location changed, so the previous location-specific search was cleared. Add an activity below. Your saved choices are unchanged.');
  update({...values,query:nextQuery,title:nextQuery===query?title:''});
 }
 const locationOptions=activityLocations(locations.map(place=>({place}))).filter(place=>place.toLocaleLowerCase('en-GB')!==destination.toLocaleLowerCase('en-GB'));
 const search=activitySearchQuery(query===destination&&location?'':query,chosenLocation);
 const match:Match={id:'activity-explorer',source:'explore',title:title||query||'Choose an activity',place:chosenLocation,query:search,category:'Experiences',kind:'Your search · confirm the operator and itinerary',quote:'',second:0,providers:['Viator','GetYourGuide']};
 const dates={start,end:end||start};
 const context=JSON.stringify([chosenLocation,search,start,end,adults,currency]);
 return <>
  <div className="eyebrow">FIND YOUR NEXT EXPERIENCE</div><h1>Compare activity options</h1>
  <p className="reservation-intro">Explore Viator and GetYourGuide, save the activities you’re interested in, and continue to the provider to book.</p>
  {initial?.selection.title&&<p className="activity-context">Selected activity: <strong>{initial.selection.title}</strong> · {initial.selection.destination||'Location to confirm'}. You can edit the provider search below{trip?'; dates and guests use this bucket':''}.</p>}
  {trip&&<p className="bucket-provider-note">Dates, adults and currency are shared with <strong>{trip.name}</strong>. Editing them here updates this bucket. Provider calendars may ask you to confirm them again.</p>}
  <div className="reservation-inputs"><label>Destination<input aria-label="Activity destination" maxLength={160} value={destination} onChange={e=>{changeLocation(e.target.value,{destination:e.target.value});setLocation('');setCustomLocation('');}}/></label><label>From<input aria-label="Activity start date" type="date" value={start} onChange={e=>update({start:e.target.value})}/></label><label>To<input aria-label="Activity end date" type="date" min={start} value={end} onChange={e=>update({end:e.target.value})}/></label><label>Adults<select aria-label="Activity adults" value={adults} onChange={e=>update({adults:Number(e.target.value)})}>{[1,2,3,4,5,6,7,8].map(n=><option key={n}>{n}</option>)}</select></label></div>
  <div className="activity-search-fields"><label>Location filter<select aria-label="Activity location filter" value={location} onChange={e=>{changeLocation(e.target.value==='custom'?customLocation:e.target.value||destination);setLocation(e.target.value);}}><option value="">All of {destination||'this destination'}</option>{locationOptions.map(place=><option key={place} value={place}>{place}</option>)}<option value="custom">Another city or area…</option></select></label>{location==='custom'&&<label>City or area<input aria-label="Activity city or area" maxLength={160} value={customLocation} onChange={e=>{changeLocation(e.target.value);setCustomLocation(e.target.value);}} placeholder="For example Ella or Ahangama"/></label>}</div>
  {locationNotice&&<p className="booking-search-note" role="status">{locationNotice}</p>}
  <p className="booking-search-note">{locationOptions.length?'Locations include places from this bucket’s analysed reels. ':''}The selected location applies to both providers. Check the activity’s meeting point; some tours depart from elsewhere.</p>
  <div className="activity-search-fields"><label>What would you like to do?<input aria-label="Activity search" value={query} maxLength={200} onChange={e=>{setLocationNotice('');update({query:e.target.value,title:''});}} placeholder="Boat cruise, food tour, safari…"/></label><label>Currency<select aria-label="Activity currency" value={currency} onChange={e=>update({currency:e.target.value})}>{['GBP','EUR','USD','INR'].map(c=><option key={c}>{c}</option>)}</select></label></div>
  <div className="tabs" role="group" aria-label="Explore provider">{['GetYourGuide','Viator'].map(p=><button key={p} aria-pressed={provider===p} className={provider===p?'active':''} onClick={()=>setProvider(p)}>{p}</button>)}</div>
  {chosenLocation.trim()&&search.trim()?(provider==='GetYourGuide'?<GetYourGuideOptions key={'gyg-'+JSON.stringify([chosenLocation,search])} query={search} date={start} end={end} adults={adults} currency={currency}/>:<section className="availability-panel" aria-label="Viator activity search"><ViatorSearch key={context} match={match} dates={dates} currency={currency} adults={adults}/></section>):<p className="bucket-provider-note">Choose a city or area above to explore provider options.</p>}
 </>;
}
