'use client';
import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {InterestEditor,InterestTripAssignments,ProviderLinkSaveForm,useInterests} from '@/components/interested';
import {useTrips} from '@/components/trip-buckets';
import {BucketNavigation,WorkspaceHeader} from '@/components/workspace-navigation';
import {SavedChoiceCard} from '@/components/source-place-card';
import {tripChatPreferences} from '@/lib/trip-planning';

export default function InterestedPage(){
 const interests=useInterests(),trips=useTrips(),[filter,setFilter]=useState('all'),[scope,setScope]=useState('trip');
 const activeScope=trips.activeTrip?scope:'all';
 const inScope=interests.items.filter(item=>activeScope==='all'||trips.activeTrip?.interestIds.includes(item.id));
 const visible=inScope.filter(item=>filter==='all'||item.kind===filter);
 return <div className="reel-app"><WorkspaceHeader active="interested"/><BucketNavigation active="interested" trip={trips.activeTrip} ready={trips.ready} error={trips.error}/><main className="reservation-examples interested-page">
  <div className="eyebrow">KEEP THE POSSIBILITIES</div><h1>Your Interested list</h1><p className="reservation-intro">Keep the specific activities, restaurants, hotels and flight searches you like. Group them by trip, then plan with the choices that matter to you.</p>
  <ProviderLinkSaveForm/>
  <label className="interest-scope">Show choices for<select value={activeScope} onChange={event=>setScope(event.target.value)}><option value="trip" disabled={!trips.activeTrip}>{trips.activeTrip?trips.activeTrip.name+' — selected bucket':'Select a bucket first'}</option><option value="all">All saved</option></select></label>
  <div className="tabs" role="group" aria-label="Filter interested choices">{[['all','All'],['restaurant','Restaurants'],['activity','Activities'],['hotel','Hotels'],['flight','Flight searches']].map(([value,label])=><button key={value} className={filter===value?'active':''} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
  {(interests.error||trips.error)&&<p className="inline-message" role="alert">{interests.error||trips.error}</p>}
  {!interests.ready||!trips.ready?<p role="status">Loading your saved choices…</p>:visible.length===0?<div className="library-empty"><h2>{activeScope==='trip'?'No choices saved for this bucket yet.':'No saved choices in this category yet.'}</h2><p>Use + Interested on a recommendation, or save a specific provider page above. Add existing choices from All saved to this bucket.</p>{activeScope==='trip'&&<button className="secondary" onClick={()=>setScope('all')}>View All saved</button>}</div>:<div className="analysis-matches">{visible.map(item=>{
   const membershipCount=trips.trips.filter(trip=>trip.interestIds.includes(item.id)).length;
   return <article className="match-card interest-card" key={item.id}><div className="match-main"><SavedChoiceCard item={item} tripId={trips.activeTrip?.id} preferences={trips.activeTrip?tripChatPreferences(trips.activeTrip):undefined}/>
    <InterestTripAssignments item={item} trips={trips}/>
    <InterestEditor item={item} onSave={details=>interests.edit(item.id,details)}/>
    <div className="state-actions"><button type="button" className="text-button" disabled={membershipCount>0||!!trips.error} aria-label={'Delete '+item.title+' from All saved'} onClick={()=>interests.remove(item)}><Trash2 size={14}/>Delete saved choice</button></div>
    {membershipCount>0&&<p className="fine-print">Remove from its trips before deleting this saved choice. Removing from one trip keeps it in the others.</p>}
   </div></article>;
  })}</div>}
  <p className="fine-print">Saved on this device. Interested means saved, not reserved. Confirm the venue, dates, party size, availability and price with the provider. Provider links may earn ReelTrip a commission.</p>
 </main></div>;
}
