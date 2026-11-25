import type {ChatPreferences} from './bundle-chat.ts';
import {getYourGuideActivityUrl} from './getyourguide.ts';
import {interestUrl,type InterestInput} from './interested.ts';
import {providerProduct} from './provider-links-save.ts';
import {skyscannerSearchUrl,type FlightCabin} from './travel-connections.ts';
import {validateDates,type Window} from './travel.ts';

export function choiceDates(preferences?:ChatPreferences,overnight=false):Window|undefined{
 const active=preferences?.dates[preferences.activeDate];
 if(!active?.start)return;
 const dates={start:active.start,end:active.end||(!overnight?active.start:'')};
 try{validateDates([dates],undefined,!overnight);return dates;}catch{return;}
}
export function savedChoiceHandoff(item:InterestInput,preferences?:ChatPreferences){
 const originalUrl=interestUrl(item.url),product=providerProduct(item.url);
 const result={originalUrl,currentUrl:null as string|null,label:'',notice:''};
 if(!preferences||!originalUrl)return result;
 const dates=choiceDates(preferences,item.kind==='hotel'||item.kind==='flight');
 if(!dates||!Number.isInteger(preferences.adults)||preferences.adults<1||preferences.adults>8||!['GBP','EUR','USD','INR'].includes(preferences.currency))return {...result,notice:'Choose valid bucket dates and guests before preparing a new provider search. The original saved page stays available.'};
 if(product?.provider==='GetYourGuide'&&product.kind==='activity')return {...result,currentUrl:getYourGuideActivityUrl(product.url,dates.start,preferences.adults),label:'Open with selected date & guests',notice:'The selected date and adult count are included. Confirm currency and availability on GetYourGuide.'};
 if(product?.provider==='Airbnb'&&product.kind==='hotel'){
  const current=new URL(product.url);current.searchParams.set('check_in',dates.start);current.searchParams.set('check_out',dates.end);current.searchParams.set('adults',String(preferences.adults));
  return {...result,currentUrl:current.href,label:'Open stay with selected dates & guests',notice:'The link includes your check-in, check-out and adults. Confirm these selections, currency and availability on Airbnb.'};
 }
 if(product?.kind==='flight'){
  // providerProduct has validated this exact Skyscanner route and its saved filters.
  const saved=new URL(product.url),parts=saved.pathname.split('/'),ranges=saved.searchParams.get('departure-times')?.split(',');
  const time=(minutes:string)=>{const n=Number(minutes);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  const window=(value:string)=>{const [from,to]=value.split('-');return {from:time(from),to:time(to)};};
  const currentUrl=skyscannerSearchUrl({origin:parts[3],destination:parts[4],dates,adults:preferences.adults,currency:preferences.currency,cabin:saved.searchParams.get('cabinclass') as FlightCabin,directOnly:saved.searchParams.get('preferdirects')==='true',...(ranges?{outboundTime:window(ranges[0]),returnTime:window(ranges[1])}:{})});
  const current=currentUrl?new URL(currentUrl):null;
  // Previously saved provider searches may include nearby airports. The saved
  // flags are validated by providerProduct and must not be silently reset.
  if(current)for(const key of ['outboundaltsenabled','inboundaltsenabled'])if(saved.searchParams.has(key))current.searchParams.set(key,saved.searchParams.get(key)!);
  return {...result,currentUrl:current?.href||null,label:'Search route with selected dates',notice:'This new search uses the selected dates, guests and currency, keeping the saved route, nearby-airport settings, cabin, stops and departure periods. Your original saved search is unchanged.'};
 }
 return {...result,notice:'Enter the selected dates and guests on this provider page. Its saved link does not automatically update with your bucket.'};
}
