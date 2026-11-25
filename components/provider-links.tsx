'use client';
import {ArrowUpRight} from 'lucide-react';
import {browseProviderUrl,hotelProviderLinks,providerUrl,type Dining,type Match,type Window} from '@/lib/travel';
import {matchedBookingPage} from '@/lib/booking-pages';
import {activityExplorerUrl} from '@/lib/activity-context';
import {itemForMatch} from '@/lib/interested';
import {BookingPreview} from './booking-preview';
import {RestaurantOptions} from './restaurant-options';
import {InterestedButton} from './interested';

export function ProviderLinks({match,dates,adults=2,currency='GBP',meal,tripId}:{match:Match;dates?:Window;adults?:number;currency?:string;meal?:Dining;tripId?:string}){
 const booking=matchedBookingPage(match);
 if(match.category==='Food')return <div className="provider-destinations">
  {booking?<><BookingPreview page={booking} meal={meal} tripId={tripId}/><details className="restaurant-alternatives"><summary>More restaurant websites</summary><RestaurantOptions kind={match.kind} query={match.query} place={match.place} direct={match.direct} meal={meal}/></details></>:<><InterestedButton item={itemForMatch(match)} tripId={tripId}/><RestaurantOptions kind={match.kind} query={match.query} place={match.place} direct={match.direct} meal={meal}/></>}
 </div>;
 const hotels=match.category==='Stays'?hotelProviderLinks(match,dates,adults,currency):[];
 const providers=match.category==='Stays'?match.providers.filter(p=>p==='Official website'):match.providers;
 return <div className="provider-destinations">
  {match.category==='Experiences'&&<div className="place-actions"><InterestedButton item={itemForMatch(match)} tripId={tripId}/><a className="provider-link" href={activityExplorerUrl(match,dates,adults,currency)}>Explore activity options<ArrowUpRight size={13}/></a></div>}
  {match.category==='Stays'&&<InterestedButton item={itemForMatch(match)} tripId={tripId}/>}
  {(providers.length>0||hotels.length>0)&&<div className="provider-links">{hotels.map(link=><a key={link.provider} className="provider-link" target="_blank" rel="noopener noreferrer" href={link.url}>{link.propertyName?'Open property on ':'Find on '}{link.provider}<ArrowUpRight size={13}/></a>)}{providers.map(p=><a key={p} className="provider-link" target="_blank" rel={p==='GetYourGuide'?'noopener noreferrer sponsored':'noopener noreferrer'} href={dates?providerUrl(match,p,dates,adults,currency,meal):browseProviderUrl(match,p)}>{p==='Official website'?'Venue website':p}<ArrowUpRight size={13}/></a>)}</div>}
  {match.category==='Stays'&&<p className="booking-search-note">{dates?'Dates and adults are included in the provider links. ':''}{hotels.some(link=>link.propertyName)?'Booking.com opens the matched property. Other providers offer name searches and may show alternatives. ':'These searches may show other properties if the named stay is unavailable or unlisted. '}Confirm the exact property, room, availability, dates and currency on the provider. Found a stay? <a href="/interested#save-link">Save its link to Interested</a>.</p>}
  {providers.includes('GetYourGuide')&&<small className="affiliate-note">ReelTrip may earn a commission from GetYourGuide bookings.</small>}
 </div>;
}
