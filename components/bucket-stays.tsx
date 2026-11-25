'use client';
import {useEffect,useRef} from 'react';
import type {TripBucket} from '@/lib/trip-buckets';
import {getTripReels} from '@/lib/trip-buckets';
import {ANALYSIS_KEY} from '@/lib/analysis-cache';
import {tripAccommodationRows,tripAnalysisRows,tripChatPreferences} from '@/lib/trip-planning';
import {useTripSources} from './use-trip-sources';
import {useReelAnalysis} from './use-reel-analysis';
import {SourcePlaceCard} from './source-place-card';

export function BucketStays({trip}:{trip:TripBucket}){
 const sources=useTripSources(),background=useReelAnalysis();
 const resolved=getTripReels(trip,sources.bundles,sources.reels),reels=useRef(resolved.reels);
 reels.current=resolved.reels;
 const reelKey=resolved.reels.map(reel=>reel.id).sort().join('|');
 useEffect(()=>{background.restore(reels.current);},[reelKey,background.restore]);
 useEffect(()=>{
  const refresh=()=>background.restore(reels.current),storage=(event:StorageEvent)=>{if(event.key===null||event.key===ANALYSIS_KEY)refresh();};
  window.addEventListener('reeltrip:analysis-changed',refresh);window.addEventListener('storage',storage);window.addEventListener('focus',refresh);
  return()=>{window.removeEventListener('reeltrip:analysis-changed',refresh);window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);};
 },[background.restore]);
 if(!sources.ready)return <p role="status">Loading this bucket’s stays…</p>;
 if(sources.error||resolved.overLimit)return <p role="alert">{sources.error||'This bucket has more than 12 reels. Review its sources before comparing stays.'} <a href="/trips?tab=sources">Review sources</a></p>;
 const rows=tripAnalysisRows(resolved.reels,background.cache),stays=tripAccommodationRows(resolved.reels,background.cache),ready=rows.filter(row=>row.analysis).length;
 return <section className="bucket-stays" aria-label={'Stays from '+trip.name}>
  <h2>Stays from {trip.name}</h2>
  <p>{ready} of {rows.length} attached reels have a breakdown. All identified stay options are shown here, with this bucket’s dates and guests.</p>
  {(resolved.missingBundleIds.length>0||resolved.missingReelIds.length>0)&&<p className="fine-print" role="status">Some attached reels or bundles are missing from this device and cannot be included. <a href="/trips?tab=sources">Review sources</a>.</p>}
  {stays.length?<div className="source-preview-grid">{stays.map(({match,source})=><SourcePlaceCard key={match.source+':'+match.id} match={match} source={source} preferences={tripChatPreferences(trip)} tripId={trip.id}/>)}</div>:<p>No stay has been identified in this bucket’s ready breakdowns. You can search for a hotel or home below.</p>}
  {ready<rows.length&&<p className="fine-print">Pending or unavailable reels may contain more stays. <a href="/trips?tab=sources">Open reels &amp; bundles to analyse or retry</a>.</p>}
  {stays.length>1&&<p className="fine-print">For a trip with several overnight stops, adjust dates on each provider page. These links use the full selected trip window.</p>}
 </section>;
}
