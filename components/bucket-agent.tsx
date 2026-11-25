'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {MessageCircle,X} from 'lucide-react';
import {useTrips} from './trip-buckets';
import {useInterests} from './interested';
import {useTripSources} from './use-trip-sources';
import {TripPlanner} from './trip-planner';
import {getTripReels} from '@/lib/trip-buckets';

export function BucketAgent(){
 const pathname=usePathname();
 if(!['/trips','/activities','/reservations','/travel','/interested'].includes(pathname||''))return null;
 return <ActiveBucketAgent/>;
}
function ActiveBucketAgent(){
 const trips=useTrips(),sources=useTripSources(),interests=useInterests();
 const [open,setOpen]=useState(false),toggle=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(open)close.current?.focus();},[open]);
 const trip=trips.activeTrip;
 if(!trips.ready||!sources.ready||!interests.ready||!trip)return null;
 const resolved=getTripReels(trip,sources.bundles,sources.reels),error=trips.error||sources.error||interests.error;
 function dismiss(){setOpen(false);toggle.current?.focus();}
 return <aside className={'bucket-agent'+(open?' is-open':'')} aria-label={'Trip agent for '+trip.name} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();dismiss();}}}>
  <button ref={toggle} className="bucket-agent-toggle" type="button" aria-expanded={open} aria-controls="bucket-agent-panel" onClick={()=>setOpen(!open)}><MessageCircle size={19} aria-hidden="true"/>Chat about {trip.name}</button>
  <div id="bucket-agent-panel" className="bucket-agent-panel"><header className="bucket-agent-heading"><div><span className="eyebrow">YOUR BUCKET AGENT</span><h2>{trip.name}</h2></div><button ref={close} className="bucket-agent-close" type="button" onClick={dismiss} aria-label="Close trip chat"><X size={20}/></button></header>
   <p className="bucket-agent-capabilities">Plan together. Prepare hotels, restaurants and activities in this chat.</p>
   <div className="bucket-agent-content">{(resolved.missingBundleIds.length>0||resolved.missingReelIds.length>0)&&<p role="status">{resolved.missingBundleIds.length} attached bundles and {resolved.missingReelIds.length} reels are missing from this device. The agent cannot include those sources. <a href="/trips?tab=sources">Review sources</a>.</p>}{trip.interestIds.some(id=>!interests.items.some(item=>item.id===id))&&<p role="status">Some saved choices are missing and are not included in this conversation.</p>}{error||resolved.overLimit?<p role="alert">{error||'This bucket has more than 12 reels. Adjust its sources before planning; everything remains saved.'}</p>:<TripPlanner view="agent" trip={trip} reels={resolved.reels} interests={interests.items.filter(item=>trip.interestIds.includes(item.id))} onPreferences={patch=>trips.update(trip.id,patch)}/>}</div>
   <p className="bucket-agent-footer">You complete bookings with the provider. Availability and reservations are not confirmed here. <a href="/trips?tab=bookings">Open booking preparation</a>.</p>
  </div>
 </aside>;
}
