// Prepared for approved partner credentials. Not exposed as a live-booking API.
import {skyscannerQuery,bookingSearch,type TravelSearch} from '../travel-connections.ts';
import {boundedJSON,ServiceError} from './http-safety.ts';
export async function searchSkyscanner(input:TravelSearch,env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
 const body=skyscannerQuery(input);if(!env.SKYSCANNER_API_KEY)throw new ServiceError('Skyscanner partner approval is required.',503);
 const response=await fetcher('https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/create',{method:'POST',headers:{'x-api-key':env.SKYSCANNER_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'manual'});
 if(!response.ok)throw new ServiceError('Skyscanner could not return this search.');return boundedJSON(response,1000000);
}
export async function pollSkyscanner(sessionToken:string,env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
 if(!/^[\w.=-]{1,1000}$/.test(sessionToken)||!env.SKYSCANNER_API_KEY)throw new ServiceError('Invalid flight search.',400);
 const response=await fetcher('https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/poll/'+encodeURIComponent(sessionToken),{method:'POST',headers:{'x-api-key':env.SKYSCANNER_API_KEY},signal:AbortSignal.timeout(15000),redirect:'manual'});
 if(!response.ok)throw new ServiceError('Flight prices could not be refreshed.');return boundedJSON(response,1000000);
}
export async function searchBooking(input:TravelSearch,env:Record<string,string|undefined>,fetcher:typeof fetch=fetch){
 const body=bookingSearch(input);if(!env.BOOKING_DEMAND_API_KEY||!env.BOOKING_AFFILIATE_ID)throw new ServiceError('Booking.com partner approval is required.',503);
 const base=env.BOOKING_ENVIRONMENT==='sandbox'?'https://demandapi-sandbox.booking.com':'https://demandapi.booking.com';
 const response=await fetcher(base+'/3.2/accommodations/search',{method:'POST',headers:{Authorization:'Bearer '+env.BOOKING_DEMAND_API_KEY,'X-Affiliate-Id':env.BOOKING_AFFILIATE_ID,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'manual'});
 if(!response.ok)throw new ServiceError('Booking.com could not return this search.');return boundedJSON(response,1000000);
}
