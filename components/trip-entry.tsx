'use client';
import {useState} from 'react';
import {TripPicker,useTrips} from './trip-buckets';
export function TripEntry(){
 const trips=useTrips(),[name,setName]=useState('');
 return <section className="trip-entry" aria-label="Choose your trip"><div><div className="eyebrow">ONE PLACE FOR EACH ADVENTURE</div><h2>Start with a trip bucket</h2><p>Bring bundles, individual reels and Interested places together. Keep Sri Lanka separate from your Amsterdam weekend.</p><TripPicker/></div><form onSubmit={e=>{e.preventDefault();if(trips.create(name))setName('');}}><label htmlFor="new-trip-name">New trip name<input id="new-trip-name" value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Sri Lanka adventure"/></label><button className="primary" disabled={!trips.ready||!name.trim()}>Create trip</button>{trips.error&&<p role="alert">{trips.error}</p>}</form></section>;
}
