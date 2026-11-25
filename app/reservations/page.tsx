'use client';
import {useState} from 'react';
import {BucketNavigation,WorkspaceHeader} from '@/components/workspace-navigation';
import {bookingPages} from '@/lib/booking-pages';
import {BookingPreview} from '@/components/booking-preview';
import {RestaurantOptions} from '@/components/restaurant-options';
import {InterestedButton} from '@/components/interested';
import {restaurantMapSearch} from '@/lib/restaurant-links';
import {useTrips} from '@/components/trip-buckets';
import type {TripBucket,TripPatch} from '@/lib/trip-buckets';

export default function ReservationsPage(){
 const trips=useTrips();
 return <div className="reel-app"><WorkspaceHeader active="restaurants"/><BucketNavigation active="restaurants" trip={trips.activeTrip} ready={trips.ready} error={trips.error}/><main className="reservation-examples">
  {trips.ready?<RestaurantExplorer key={trips.activeId||'unassigned'} trip={trips.activeTrip} onPreferences={patch=>trips.activeTrip?trips.update(trips.activeTrip.id,patch):false}/>:<p role="status">Loading restaurant search…</p>}
 </main></div>;
}

function RestaurantExplorer({trip,onPreferences}:{trip:TripBucket|null;onPreferences:(patch:TripPatch)=>boolean}){
 const [dateChoice,setDateChoice]=useState<{window:string;date:string}|null>(null),[time,setTime]=useState('19:00'),[guestCovers,setGuestCovers]=useState(2);
 const [query,setQuery]=useState(''),[place,setPlace]=useState(trip?.destination||'');
 const [search,setSearch]=useState<{query:string;place:string}|null>(null);
 const dateWindow=JSON.stringify([trip?.activeDate,trip?.dates[trip.activeDate]]);
 const date=dateChoice?.window===dateWindow?dateChoice.date:trip?.dates[trip.activeDate].start||'';
 const covers=trip?.adults||guestCovers;
 const meal=date?{date,time,covers}:undefined;
 return <>
  <div className="eyebrow">RESTAURANTS FROM YOUR REELS</div><h1>Find your next table</h1>
  <p className="reservation-intro">Look up a restaurant or explore a destination. Choose a region to see more booking websites, then check the exact venue and current availability with the provider.</p>
  {trip&&<p className="bucket-provider-note">Using <strong>{trip.name}</strong>’s destination, dates and guests. Choose a dining day and local time below; these apply to this restaurant search. Changing guests updates the bucket.</p>}
  <div className="reservation-inputs"><label>Dining date<input aria-label="Dining date" type="date" value={date} onChange={e=>setDateChoice({window:dateWindow,date:e.target.value})}/></label><label>Time<select aria-label="Dining time" value={time} onChange={e=>setTime(e.target.value)}>{Array.from({length:48},(_,i)=>`${String(Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`).map(t=><option key={t}>{t}</option>)}</select></label><label>Guests<select aria-label="Dining guests" value={covers} onChange={e=>trip?onPreferences({adults:Number(e.target.value)}):setGuestCovers(Number(e.target.value))}>{Array.from({length:trip?8:20},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label></div>
  <form className="restaurant-search" onSubmit={event=>{event.preventDefault();if(query.trim()||place.trim())setSearch({query:query.trim()||'restaurants',place:place.trim()});}}>
   <div className="reservation-inputs"><label>Restaurant or cuisine<input aria-label="Restaurant or cuisine" placeholder="A restaurant name, or Sri Lankan food" value={query} maxLength={240} onChange={event=>setQuery(event.target.value)}/></label><label>City or destination<input aria-label="Restaurant city or destination" placeholder="Colombo, Sri Lanka" value={place} maxLength={160} onChange={event=>setPlace(event.target.value)}/></label></div>
   <button className="primary" type="submit" disabled={!query.trim()&&!place.trim()}>Find restaurants</button>
  </form>
  {search&&<div className="restaurant-search-result"><h2>{search.query}{search.place?` in ${search.place}`:''}</h2><InterestedButton item={{kind:'restaurant',title:`Search: ${search.query}`,place:search.place,provider:'Google Maps restaurant search',url:restaurantMapSearch(search.query,search.place)}}/><p className="fine-print">Save this search to Interested while you find the right venue.</p></div>}
  <RestaurantOptions query={search?.query||'restaurants'} place={search?.place||trip?.destination||''} meal={meal}/>
  <h2>Verified reservation page previews</h2>
  <p className="reservation-intro">These two London examples have verified booking-page links; they are not recommendations for your bucket. Your date, time and guest count are carried through when you open their reservation pages.</p>
  <div className="reservation-preview-grid">{bookingPages.map(page=><BookingPreview key={page.id} page={page} meal={meal}/>)}</div>
  <p className="fine-print">Each preview is a saved public page snippet. Availability and prices are checked on the provider’s website. No table is held or reserved by opening a preview.</p>
 </>;
}
