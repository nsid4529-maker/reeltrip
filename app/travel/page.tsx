'use client';
import {useEffect,useState} from 'react';
import {useTrips} from '@/components/trip-buckets';
import {BucketNavigation,WorkspaceHeader} from '@/components/workspace-navigation';
import {TravelConnections} from '@/components/travel-connections';
import {BucketStays} from '@/components/bucket-stays';
import {GUEST_TRIP_KEY,readTripPreferences,withTripPreferences} from '@/lib/trip-preferences';
import type {Trip} from '@/lib/travel';

export default function TravelPage(){
 const [storageError,setStorageError]=useState('');
 const trips=useTrips(),currentTrip=trips.activeTrip;
 const [guestTrip,setTrip]=useState<Trip>({prompt:'',selected:[],dates:[{start:'',end:''}],activeDate:0,adults:2,currency:'GBP'});
 useEffect(()=>{
  try{
   const preferences=readTripPreferences(localStorage.getItem(GUEST_TRIP_KEY));
   setTrip(t=>({...t,...preferences}));
  }catch{}
 },[]);
 const trip:Trip=currentTrip?{prompt:currentTrip.brief,selected:[],dates:currentTrip.dates,activeDate:currentTrip.activeDate,adults:currentTrip.adults,currency:currentTrip.currency}:guestTrip;
 function update(p:Partial<Trip>){const next={...trip,...p};if(currentTrip){trips.update(currentTrip.id,{dates:next.dates,activeDate:next.activeDate,adults:next.adults,currency:next.currency});return;}setTrip(next);try{localStorage.setItem(GUEST_TRIP_KEY,withTripPreferences(localStorage.getItem(GUEST_TRIP_KEY),next));setStorageError('');}catch{setStorageError('Your changes are available on this page, but could not be saved on this device.');}}
 const dates=trip.dates[trip.activeDate];
 function updateDate(field:'start'|'end',value:string){update({dates:trip.dates.map((d,i)=>i===trip.activeDate?{...d,[field]:value}:d)});}
 return <div className="reel-app"><WorkspaceHeader active="travel"/><BucketNavigation active="travel" trip={trips.activeTrip} ready={trips.ready} error={trips.error}/><main className="reservation-examples travel-page">
  <div className="eyebrow">MAKE THE JOURNEY YOURS</div><h1>Flights & hotels</h1>
  <p className="reservation-intro">Find your route and a place to stay. Start with your trip dates, then compare options with the providers.</p>
  {currentTrip&&<p className="bucket-provider-note">Dates, adults and currency are shared with <strong>{currentTrip.name}</strong>. Editing them here updates this bucket and its provider searches.</p>}
  <section aria-label="Travel dates and guests" className="reservation-inputs travel-date-fields">
   <label>Departure / check-in<input type="date" value={dates.start} onChange={e=>updateDate('start',e.target.value)}/></label>
   <label>Return / check-out<input type="date" value={dates.end} onChange={e=>updateDate('end',e.target.value)}/></label>
   <label>Adults<select value={trip.adults} onChange={e=>update({adults:Number(e.target.value)})}>{Array.from({length:8},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
   <label>Currency<select value={trip.currency} onChange={e=>update({currency:e.target.value})}>{['GBP','EUR','USD','INR'].map(c=><option key={c}>{c}</option>)}</select></label>
  </section>
  {storageError&&<p role="alert" className="interest-error">{storageError}</p>}
  {currentTrip&&<BucketStays key={'stays:'+currentTrip.id} trip={currentTrip}/>}
  <TravelConnections key={'travel:'+(currentTrip?.id||'unassigned')} trip={trip}/>
  <section className="activity-context"><strong>Found a stay you like?</strong><p>Copy its Booking.com, Expedia or Airbnb listing link and <a href="/interested#save-link">save it to Interested</a>.</p><p className="fine-print">On iPhone, Share → ReelTrip supports Booking.com and Expedia in app version 0.3.0 or later. For Airbnb, paste the listing link into Interested. Saved choices stay on this device.</p></section>
 </main></div>;
}
