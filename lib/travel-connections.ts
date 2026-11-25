import {validateDates} from './travel.ts';
import {calendarDay,calendarTimeZone} from './calendar-day.ts';
import type {Window} from './travel.ts';
export {hotelSearchLinks} from './travel.ts';
export type {HotelSearchLink} from './travel.ts';
export type DepartureTimeWindow={from:string;to:string};
export type FlightCabin='economy'|'premiumeconomy'|'business'|'first';
export type FlightSearch={origin:string;destination:string;dates:Window;adults:number;currency:string;cabin?:FlightCabin;directOnly?:boolean;outboundTime?:DepartureTimeWindow;returnTime?:DepartureTimeWindow};
function departureMinutes(time:string){
 if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Choose a valid departure time.');
 const [hours,minutes]=time.split(':').map(Number);return hours*60+minutes;
}
function departureRange(window?:DepartureTimeWindow){
 if(!window)return '0-1439';
 const from=departureMinutes(window.from),to=departureMinutes(window.to);
 if(from>=to)throw new Error('The departure time range must end after it starts.');
 return `${from}-${to}`;
}
export function flightSearchError(input:FlightSearch):string{
 try{
  validateDates([input.dates]);
  const origin=input.origin.trim().toUpperCase(),destination=input.destination.trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(origin)||! /^[A-Z]{3}$/.test(destination))throw new Error('Enter three-letter airport codes, such as LHR and AMS.');
  if(origin===destination)throw new Error('Choose different departure and arrival airports.');
  if(!Number.isInteger(input.adults)||input.adults<1||input.adults>8)throw new Error('Choose between 1 and 8 adults.');
  if(!['GBP','EUR','USD','INR'].includes(input.currency))throw new Error('Choose a supported currency.');
  if(input.cabin!==undefined&&!['economy','premiumeconomy','business','first'].includes(input.cabin))throw new Error('Choose a supported cabin class.');
  if(input.directOnly!==undefined&&typeof input.directOnly!=='boolean')throw new Error('Choose whether direct flights are required.');
  departureRange(input.outboundTime);departureRange(input.returnTime);
  return '';
 }catch(error){return error instanceof Error?error.message:'Check your flight search details.';}
}
// Public day-view route linked by Skyscanner's official parameter documentation:
// https://developers.skyscanner.net/docs/referrals/flights-parameters
// Browser-verified on 2026-11-18: airports, dates, adults, GBP, and both local
// departure-time ranges appear in the provider's visible search controls.
export function skyscannerSearchUrl(input:FlightSearch):string{
 if(flightSearchError(input))return '';
 const date=(value:string)=>value.slice(2).replaceAll('-','');
 const origin=input.origin.trim().toLowerCase(),destination=input.destination.trim().toLowerCase();
 const url=new URL(`https://www.skyscanner.net/transport/flights/${origin}/${destination}/${date(input.dates.start)}/${date(input.dates.end)}/`);
 url.searchParams.set('adultsv2',String(input.adults));url.searchParams.set('cabinclass',input.cabin||'economy');url.searchParams.set('currency',input.currency);
 url.searchParams.set('rtn','1');url.searchParams.set('preferdirects',String(input.directOnly||false));
 url.searchParams.set('outboundaltsenabled','false');url.searchParams.set('inboundaltsenabled','false');
 if(input.outboundTime||input.returnTime)url.searchParams.set('departure-times',`${departureRange(input.outboundTime)},${departureRange(input.returnTime)}`);
 return url.href;
}
export type TravelSearch={origin:string;destination:string;start:string;end:string;adults:number;currency:string;country:string;platform:'desktop'|'mobile';hotelCity?:number;timeZone?:string};
export function validateTravelSearch(input:TravelSearch){
 validateDates([{start:input.start,end:input.end}],calendarDay(calendarTimeZone(input.timeZone)));
 if(!/^[A-Z]{3}$/.test(input.origin)||!/^([A-Z]{3})$/.test(input.destination)||input.origin===input.destination||!Number.isInteger(input.adults)||input.adults<1||input.adults>8||!['GBP','EUR','USD','INR'].includes(input.currency)||!/^[A-Z]{2}$/.test(input.country)||!['desktop','mobile'].includes(input.platform))throw new Error('Check airports, country and travellers.');
}
export function skyscannerQuery(input:TravelSearch){validateTravelSearch(input);const date=(s:string)=>{const [year,month,day]=s.split('-').map(Number);return {year,month,day};};return {query:{market:input.country==='GB'?'UK':input.country,locale:'en-GB',currency:input.currency,adults:input.adults,cabinClass:'CABIN_CLASS_ECONOMY',queryLegs:[{originPlaceId:{iata:input.origin},destinationPlaceId:{iata:input.destination},date:date(input.start)},{originPlaceId:{iata:input.destination},destinationPlaceId:{iata:input.origin},date:date(input.end)}]}};}
export function bookingSearch(input:TravelSearch){validateTravelSearch(input);if(!Number.isInteger(input.hotelCity)||input.hotelCity===0)throw new Error('Choose a verified Booking.com destination.');return {booker:{country:input.country.toLowerCase(),platform:input.platform},checkin:input.start,checkout:input.end,city:input.hotelCity,currency:input.currency,guests:{number_of_adults:input.adults,number_of_rooms:1},extras:['extra_charges','products']};}
export function travelConnections(env:Record<string,string|undefined>){return [
 {provider:'Skyscanner',kind:'Flights',status:env.SKYSCANNER_API_KEY?'configured_not_verified':'setup_required',checkout:'Provider checkout',message:env.SKYSCANNER_API_KEY?'Credentials added; partner testing is still required.':'Flight comparison is awaiting partner approval.'},
 {provider:'Booking.com',kind:'Hotels',status:env.BOOKING_DEMAND_API_KEY&&env.BOOKING_AFFILIATE_ID?'configured_not_verified':'setup_required',checkout:'Not enabled',message:'In-app hotel booking awaits partner approval, payment setup and booking-flow testing.'},
 {provider:'Other airlines and hotels',kind:'Additional inventory',status:'setup_required',checkout:'Not enabled',message:'Coverage depends on approved suppliers. No all-airline or all-hotel coverage is claimed.'}
 ];}
