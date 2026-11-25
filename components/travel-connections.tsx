'use client';
import {useId,useState} from 'react';
import {validateDates,type Trip} from '@/lib/travel';
import {flightSearchError,hotelSearchLinks,skyscannerSearchUrl,type DepartureTimeWindow,type FlightCabin} from '@/lib/travel-connections';
import {InterestedButton} from '@/components/interested';
import {SkyscannerWidget} from '@/components/skyscanner-widget';

const departurePeriods:{value:string;label:string;window?:DepartureTimeWindow}[]=[
 {value:'any',label:'Any time'},
 {value:'early',label:'Early · 00:00–06:00',window:{from:'00:00',to:'06:00'}},
 {value:'morning',label:'Morning · 06:00–12:00',window:{from:'06:00',to:'12:00'}},
 {value:'afternoon',label:'Afternoon · 12:00–18:00',window:{from:'12:00',to:'18:00'}},
 {value:'evening',label:'Evening · 18:00–23:59',window:{from:'18:00',to:'23:59'}}
];

export function TravelConnections({trip}:{trip:Trip}){
 const [hotelDestination,setHotelDestination]=useState('');
 const [origin,setOrigin]=useState('');
 const [destination,setDestination]=useState('');
 const [outboundPeriod,setOutboundPeriod]=useState('any');
 const [returnPeriod,setReturnPeriod]=useState('any');
 const [cabin,setCabin]=useState<FlightCabin>('economy'),[directOnly,setDirectOnly]=useState(false);
 const hintId=useId();
 const dates=trip.dates[trip.activeDate]||trip.dates[0]||{start:'',end:''};
 let dateError='';try{validateDates([dates]);}catch(error){dateError=error instanceof Error?error.message:'Choose valid trip dates.';}
 const flight={origin,destination,dates,adults:trip.adults,currency:trip.currency,cabin,directOnly,outboundTime:departurePeriods.find(period=>period.value===outboundPeriod)?.window,returnTime:departurePeriods.find(period=>period.value===returnPeriod)?.window};
 const flightUrl=skyscannerSearchUrl(flight);
 const flightError=origin||destination?flightSearchError(flight):'';
 const hotels=dateError?[]:hotelSearchLinks(hotelDestination,dates,trip.adults,trip.currency);
 return <section className="travel-connections" aria-label="Flights and hotels">
  <h3>Flights & hotels</h3>
  <p>{dateError?'Add your trip dates above to personalise these searches.':`${dates.start} → ${dates.end} · ${trip.adults} ${trip.adults===1?'adult':'adults'} · 1 room`}</p>
  {dateError&&<p className="booking-search-note" role="status">{dateError}</p>}
  <article>
   <h4>Flights · Skyscanner</h4>
   <p>Set your flight search here, then open matching results on Skyscanner. Your selected dates, travellers and filters are included in that link.</p>
   <div className="reservation-inputs flight-search-fields">
    <label>From · airport code<input aria-label="Departure airport code" aria-describedby={hintId} autoCapitalize="characters" spellCheck={false} value={origin} maxLength={3} onChange={event=>setOrigin(event.target.value.toUpperCase())} placeholder="LHR"/></label>
    <label>To · airport code<input aria-label="Arrival airport code" aria-describedby={hintId} autoCapitalize="characters" spellCheck={false} value={destination} maxLength={3} onChange={event=>setDestination(event.target.value.toUpperCase())} placeholder="AMS"/></label>
    <label>Outbound departure<select value={outboundPeriod} onChange={event=>setOutboundPeriod(event.target.value)}>{departurePeriods.map(period=><option key={period.value} value={period.value}>{period.label}</option>)}</select></label>
    <label>Return departure<select value={returnPeriod} onChange={event=>setReturnPeriod(event.target.value)}>{departurePeriods.map(period=><option key={period.value} value={period.value}>{period.label}</option>)}</select></label>
    <label>Cabin class<select value={cabin} onChange={event=>setCabin(event.target.value as FlightCabin)}><option value="economy">Economy</option><option value="premiumeconomy">Premium economy</option><option value="business">Business</option><option value="first">First</option></select></label>
    <label>Stops<select aria-label="Flight stops" value={directOnly?'direct':'any'} onChange={event=>setDirectOnly(event.target.value==='direct')}><option value="any">Any number of stops</option><option value="direct">Direct flights only</option></select></label>
   </div>
   <p id={hintId} className="booking-search-note">Use three-letter airport codes, for example LHR for London Heathrow or AMS for Amsterdam. Departure times are local to each airport.</p>
   {flightError&&!dateError&&<p className="booking-search-note" role="status">{flightError}</p>}
   {flightUrl?<><p className="booking-search-note" aria-label="Flight search summary"><strong>{origin} to {destination}</strong> · {dates.start} to {dates.end} · {trip.adults} {trip.adults===1?'adult':'adults'} · {cabin==='premiumeconomy'?'Premium economy':cabin} · {directOnly?'Direct only':'Any stops'} · {trip.currency}<br/>Outbound: {departurePeriods.find(period=>period.value===outboundPeriod)?.label}. Return: {departurePeriods.find(period=>period.value===returnPeriod)?.label}.</p><a className="primary" href={flightUrl} target="_blank" rel="noopener noreferrer">Search Skyscanner with these filters</a><p className="fine-print">This opens results for the search above. Check the displayed selections on Skyscanner before choosing a flight.</p></>:<span className="fine-print">Enter two different airport codes and valid trip dates to search.</span>}
   {flightUrl&&<div className="flight-save"><InterestedButton item={{kind:'flight',title:`${origin} → ${destination} · ${dates.start} to ${dates.end}`,place:destination,provider:'Skyscanner',url:flightUrl}}/><p className="fine-print">Saves this route, dates and filters to your shortlist. Choose and book a specific flight on Skyscanner.</p></div>}
   <details className="activity-link-entry"><summary>Optional Skyscanner search widget</summary><p className="booking-search-note">This is a separate provider form. To retain all your ReelTrip filters, use <strong>Search Skyscanner with these filters</strong> above. The widget does not import your adult count, cabin or departure-time filters; set them inside Skyscanner if you use it.</p><SkyscannerWidget flight={flight}/></details>
  </article>
  <article>
   <h4>Compare hotels & stays</h4>
   <label>City or hotel name<input aria-label="Hotel city or property name" value={hotelDestination} maxLength={120} onChange={event=>setHotelDestination(event.target.value)} placeholder="Ahangama, Sri Lanka"/></label>
   <div className="provider-links">{hotels.map(link=><a key={link.provider} href={link.url} target="_blank" rel="noopener noreferrer">Search {link.provider} for these dates</a>)}</div>
   <p className="booking-search-note">Booking.com and Expedia searches use one room; Airbnb includes homes and rooms. The links include your dates and adults. Confirm the property and selections after opening; searches can return alternatives. Booking.com uses {trip.currency}; check the currency on Expedia and Airbnb.</p>
  </article>
  <p className="fine-print">Confirm the destination and details with the provider. Prices, availability and payments are handled on their website; no reservation has been made.</p>
 </section>;
}
