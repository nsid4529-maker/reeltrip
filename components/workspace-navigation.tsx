'use client';
import type {MouseEvent} from 'react';
import {Compass,Plus} from 'lucide-react';
import {TripPicker} from '@/components/trip-buckets';
import type {TripBucket} from '@/lib/trip-buckets';
import {openReelUpload} from '@/components/reel-upload';

type WorkspacePage='library'|'trips'|'activities'|'restaurants'|'travel'|'interested'|'shared';
export type BucketSection='overview'|'sources'|'interested'|'itinerary'|'bookings'|'activities'|'restaurants'|'travel';
const bucketLinks:[BucketSection,string,string][]=[
 ['overview','Overview','/trips?tab=overview'],['sources','Reels & bundles','/trips?tab=sources'],
 ['interested','Interested','/interested'],['itinerary','Itinerary','/trips?tab=itinerary'],
 ['bookings','Bookings','/trips?tab=bookings'],['activities','Activities','/activities'],
 ['restaurants','Restaurants','/reservations'],['travel','Flights & hotels','/travel']
];

export function WorkspaceHeader({active,onLibrary,onHelp,onUpload,helpHref}:{active?:WorkspacePage;onLibrary?:()=>void;onHelp?:()=>void;onUpload?:()=>void;helpHref?:string}){
 function openLocal(event:MouseEvent<HTMLAnchorElement>,action?:()=>void){
  if(action&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();action();}
 }
 const inBucket=!!active&&active!=='library'&&active!=='shared';
 return <header className="topbar workspace-header">
  <a className="brand" href="/" aria-label="ReelTrip home" onClick={event=>openLocal(event,onLibrary)}><Compass size={25} aria-hidden="true"/>reeltrip<span className="brand-dot">.</span></a>
  <nav className="workspace-nav" aria-label="Main navigation">
   <a className={'workspace-nav-link'+(active==='library'?' is-current':'')} href="/" aria-current={active==='library'?'page':undefined} onClick={event=>openLocal(event,onLibrary)}>Reels</a>
   <a className={'workspace-nav-link'+(inBucket?' is-current':'')} href="/trips" aria-current={inBucket?'page':undefined}>Buckets</a>
   <a className={'workspace-nav-link'+(active==='shared'?' is-current':'')} href="/shared" aria-current={active==='shared'?'page':undefined}>Shared</a>
  </nav>
  {active!=='shared'&&<><button className="primary workspace-upload" type="button" onClick={()=>onUpload?onUpload():openReelUpload()}><Plus size={17} aria-hidden="true"/>Upload reel</button>
  <div className="workspace-context"><TripPicker className="workspace-trip-picker"/><a className="workspace-new-trip" href="/trips?new=1"><Plus size={15} aria-hidden="true"/>New bucket</a></div></>}
  <a className="workspace-help" href={helpHref||(active==='shared'?'/shared':'/?help=1')} onClick={event=>openLocal(event,onHelp)}>How it works</a>
 </header>;
}

export function BucketNavigation({active,trip,ready=true,error=''}:{active:BucketSection;trip:TripBucket|null;ready?:boolean;error?:string}){
 if(!trip&&['overview','sources','itinerary','bookings'].includes(active))return null;
 if(!ready)return <div className="bucket-navigation bucket-navigation-status" role="status">Loading your bucket…</div>;
 if(error)return <div className="bucket-navigation bucket-navigation-status" role="alert">{error}</div>;
 if(!trip)return <section className="bucket-navigation bucket-context-empty" aria-label="No bucket selected"><div><h2>Choose a bucket to plan your trip</h2><p>Select one in the header, or create a bucket. Browsing here is currently outside a bucket.</p></div><a className="secondary" href="/trips">Choose or create a bucket</a></section>;
 const dates=trip.dates[trip.activeDate];
 return <section className="bucket-navigation" aria-label={trip.name+' bucket'}>
  <div className="bucket-context-heading"><div><span className="eyebrow">YOUR BUCKET</span><strong>{trip.name}</strong></div><p>{[trip.destination,dates.start?(dates.end?`${dates.start} → ${dates.end}`:dates.start):'Dates to decide',`${trip.adults} ${trip.adults===1?'adult':'adults'}`].filter(Boolean).join(' · ')}</p></div>
  <nav className="bucket-section-nav" aria-label="Bucket sections">{bucketLinks.map(([id,label,href])=><a key={id} href={href} aria-current={active===id?'page':undefined}>{label}</a>)}</nav>
 </section>;
}
