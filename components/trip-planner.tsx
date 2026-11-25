'use client';
import {useEffect,useRef,useState} from 'react';
import type {TripBucket,TripPatch} from '@/lib/trip-buckets';
import type {Reel} from '@/lib/reel-library';
import {interestUrl,type Interest} from '@/lib/interested';
import type {VideoAnalysis} from '@/lib/analysis';
import {tripAnalysisRows,tripChatPreferences,reviewedReel} from '@/lib/trip-planning';
import {CHAT_INTEREST_LIMIT} from '@/lib/bundle-chat';
import {useReelAnalysis} from '@/components/use-reel-analysis';
import {BundleChat,BundleCoverage} from '@/components/bundle-chat';
import {ItineraryView} from '@/components/itinerary';
import {ReelPreview} from '@/components/reel-preview';
import {BucketItineraryChoices} from '@/components/bucket-itinerary';
import {SpecialistPreparation} from '@/components/specialist-preparation';
import {ANALYSIS_KEY} from '@/lib/analysis-cache';
import {BucketMap,StayHandoff,type BucketMapPlace} from '@/components/bucket-map';
import {BUCKETS_KEY,readBuckets} from '@/lib/reel-buckets';
type Props={trip:TripBucket;reels:Reel[];interests:Interest[];onPreferences?:(patch:TripPatch)=>void;view?:'sources'|'itinerary'|'agent'|'bookings'};
export function TripPlanner(props:Props){return <Planner key={props.trip.id} {...props}/>;}
function Planner({trip,reels,interests,onPreferences,view='sources'}:Props){
 const background=useReelAnalysis(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [itineraryRun,setItineraryRun]=useState(0),[preview,setPreview]=useState('');
 const alive=useRef(true),run=useRef(0),selectedReels=useRef(reels);
 const reelKey=reels.map(r=>r.id).sort().join('|');selectedReels.current=reels;
 useEffect(()=>{run.current++;setBusy(false);background.restore(selectedReels.current);},[reelKey,background.restore]);
 useEffect(()=>{const refresh=()=>background.restore(selectedReels.current);const storage=(event:StorageEvent)=>{if(event.key===ANALYSIS_KEY||event.key===null)refresh();};window.addEventListener('reeltrip:analysis-changed',refresh);window.addEventListener('storage',storage);return()=>{window.removeEventListener('reeltrip:analysis-changed',refresh);window.removeEventListener('storage',storage);};},[background.restore]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;run.current++;};},[]);
 const rows=tripAnalysisRows(reels,background.cache),analyses=rows.flatMap(row=>row.analysis?[row.analysis]:[]) as VideoAnalysis[];
 async function analyse(refresh=false){
  if(busy)return;const generation=++run.current;setBusy(true);setNotice('');
  // A bounded two-worker queue runs only after this explicit action. Completed
  // and reviewed analyses are reused; failed jobs retry only on this request.
  const pending=rows.filter(row=>refresh?!reviewedReel(row.reel):!row.analysis&&row.status!=='excluded').map(row=>row.reel);let index=0;
  await Promise.all([0,1].map(async()=>{while(index<pending.length&&alive.current&&generation===run.current){const reel=pending[index++];try{await background.ensure(reel,true,refresh);}catch{/* Individual source status is shown below. */}}}));
  if(alive.current&&generation===run.current){setBusy(false);setNotice('Analysis check finished. Any unavailable sources remain saved and are listed below.');}
 }
 const waiting=rows.filter(row=>!row.analysis&&row.status!=='excluded').length;
 const sourceNames=rows.map(row=>row.analysis?.source.title||row.reel.platform+' reel');
 if(view==='agent')return analyses.length||interests.length||trip.destination.trim()?<BundleChat bundle={{id:trip.id,name:trip.name,reelIds:reels.map(r=>r.id),createdAt:trip.createdAt}} mode="trip" analyses={analyses} total={reels.length} interests={interests} preferences={tripChatPreferences(trip)} tripId={trip.id} showCoverage={false} onApply={onPreferences?brief=>onPreferences({brief}):undefined}/>:<div className="bucket-agent-empty"><h3>Let’s shape {trip.name}.</h3><p>Save a place you like or attach a reel to give me something to work with. I’ll help compare your choices and prepare your plan.</p><a className="secondary" href="/trips?tab=sources">Add reels &amp; bundles</a><a className="text-button" href="/interested#save-link">Save a place link</a><p className="fine-print">{waiting?'Your attached reels need analysis. Open Reels & bundles to start or retry it.':'Your bucket’s dates and preferences stay with your choices.'}</p></div>;
 if(view==='bookings'){
  // Pins are coloured by the bundle each reel came from; others are individual reels.
  let bundles:ReturnType<typeof readBuckets>=[];try{bundles=readBuckets(localStorage.getItem(BUCKETS_KEY)).filter(b=>trip.bundleIds.includes(b.id));}catch{}
  const mapPlaces:BucketMapPlace[]=rows.flatMap(row=>{const bundle=bundles.find(b=>b.reelIds.includes(row.reel.id));const source=row.analysis?.source;
   return (row.analysis?.matches||[]).map(m=>({key:m.id,title:m.title,place:m.place,query:m.query,kind:m.kind,category:m.category,group:bundle?{id:bundle.id,name:bundle.name}:{id:'individual',name:'Individual reels'},source:source&&source.platform!=='Uploaded video'?{url:source.source_url,creator:source.creator,second:m.second}:undefined}));});
  const dates=trip.dates[trip.activeDate],handoffTrip={start:dates?.start||null,end:dates?.end||null,travellers:trip.adults};
  return <>
   <StayHandoff places={mapPlaces} fallbackArea={trip.destination||trip.name} trip={handoffTrip}/>
   <BucketMap places={mapPlaces} trip={handoffTrip}/>
   <SpecialistPreparation preferences={tripChatPreferences(trip)} analyses={analyses} interests={interests} tripId={trip.id} total={reels.length}/>
  </>;
 }
 if(view==='itinerary')return <section className="bucket-itinerary"><BucketItineraryChoices trip={trip} interests={interests}/><p className="fine-print">{analyses.length} of {rows.length} attached reels are ready. {rows.length>analyses.length?'Pending or unavailable reels are not included in this draft.':''} Reel ideas appear in the generated draft below; your Interested choices can be assigned to days above.</p>{analyses.length>0?<><ItineraryView trip={{prompt:trip.brief,selected:analyses.map(a=>a.source.id),dates:trip.dates,activeDate:trip.activeDate,adults:trip.adults,currency:trip.currency,diningTime:'19:00'}} run={itineraryRun} onGenerate={()=>setItineraryRun(n=>n+1)} onGenerated={()=>setItineraryRun(0)} onSource={setPreview} analysis={analyses} scopeId={trip.id}/>{analyses.filter(a=>a.source.id===preview).map(a=><ReelPreview key={a.source.id} url={a.source.source_url} title={a.source.title} creator={a.source.creator}/>)}</>:<div className="trip-empty-message"><h2>Give your itinerary a starting point.</h2><p>Attach and analyse a reel to add an automatic draft of its places. Your Interested choices can already be planned above and discussed with the bucket agent.</p><a className="secondary" href="/trips?tab=sources">Open reels &amp; bundles</a></div>}</section>;
 return <section className="trip-planner" aria-label={'Plan '+trip.name}>
  <div className="section-heading"><div><div className="eyebrow">YOUR TRIP SOURCES</div><h2>Bring your ideas together</h2><p>{analyses.length} of {rows.length} reels ready · {interests.length} interested choices. Reviewed examples and saved breakdowns are reused.</p></div>{waiting>0&&<button className="primary" disabled={busy} onClick={()=>void analyse()}>{busy?'Checking your reels…':'Analyse / refresh pending reels'}</button>}</div>
  {rows.some(row=>row.analysis&&!reviewedReel(row.reel))&&<button className="secondary" disabled={busy} onClick={()=>void analyse(true)}>Refresh saved analyses</button>}<p className="fine-print">New processing starts only when you ask. Refresh checks the server cache first; an expired result may need video analysis again.</p>{notice&&<p role="status">{notice}</p>}
  {!!rows.length&&<details className="trip-source-status"><summary>Reel analysis status · {analyses.length}/{rows.length} ready</summary><ul>{rows.map((row,index)=><li key={row.reel.id}><a href={row.reel.url} target="_blank" rel="noopener noreferrer">{sourceNames[index]}</a><span className="status-pill">{row.status==='complete'?(reviewedReel(row.reel)?'Reviewed · ready':'Analysed · ready'):row.status==='working'?'Processing':row.status==='error'?'Needs attention':row.status==='excluded'?'No travel breakdown':'Not analysed yet'}</span>{row.message&&<p>{row.message}</p>}</li>)}</ul></details>}
  {analyses.length>0&&<BundleCoverage analyses={analyses}/>}
  <section className="trip-interest-summary" aria-label="Interested choices for this trip"><h3>Your Interested shortlist</h3>{!interests.length?<p>Save a restaurant, activity, hotel or flight search to this trip to include it here.</p>:<><p>These are your choices, separate from the reel evidence. {interests.length>CHAT_INTEREST_LIMIT?`All ${interests.length} remain saved; chat currently includes the first ${CHAT_INTEREST_LIMIT}.`:''}</p>{(['restaurant','activity','hotel','flight'] as const).map(kind=>{const list=interests.filter(item=>item.kind===kind);return list.length>0&&<details open key={kind}><summary>{kind==='restaurant'?'Food & restaurants':kind==='activity'?'Activities':kind==='hotel'?'Hotels':'Flight searches'} · {list.length}</summary><ul>{list.map(item=><li key={item.id}><strong>{item.title}</strong>{item.place&&<span> · {item.place}</span>} <span className="fine-print">{item.provider}{interests.indexOf(item)>=CHAT_INTEREST_LIMIT?' · Not included in this conversation':''}</span>{item.notes&&<p>Your preference: {item.notes}</p>}{interestUrl(item.url)&&<a href={interestUrl(item.url)!} target="_blank" rel="noopener noreferrer">Open saved page</a>}</li>)}</ul></details>;})}</>}</section>
 </section>;
}
