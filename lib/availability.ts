import {validateDates,validateDining,diningDays,type Window,type Dining} from './travel.ts';
import {calendarDay,calendarTimeZone} from './calendar-day.ts';
export type AvailabilityRequest={matchIds:string[];dates:Window;day:string;adults:number;currency:string;dining:Dining;timeZone?:string;analysisId?:string;analysisIds?:string[]};
export type AvailabilityState='available'|'unavailable'|'setup_required'|'mapping_required'|'access_denied'|'provider_error';
export type AvailabilityResult={matchId:string;provider:string;status:AvailabilityState;message:string;slots:{label:string;time?:string}[];checkedAt?:string;environment?:'sandbox'|'production';thirdParty?:boolean};
export function validateAvailability(value:AvailabilityRequest){
 if(!value||!Array.isArray(value.matchIds)||value.matchIds.length<1||value.matchIds.length>16||value.matchIds.some(s=>typeof s!=='string'||s.length>100))throw new Error('Choose 1–16 places from the video breakdown.');
 const today=calendarDay(calendarTimeZone(value.timeZone));
 validateDates([value.dates],today);
 if(!value.dining)throw new Error('Choose a dining date, time and party size.');
 validateDining(value.dining,value.dates,today);
 if(!diningDays(value.dates).includes(value.day))throw new Error('Choose an activity day within your travel dates.');
 if(!Number.isInteger(value.adults)||value.adults<1||value.adults>8)throw new Error('Choose 1–8 adult travellers.');
 if(!['GBP','EUR','USD','INR'].includes(value.currency))throw new Error('Choose a supported currency.');
}
function localTime(value:unknown,date:string):{label:string;time:string}{
 if(typeof value!=='string')throw new Error('Invalid availability time.');
 // Accept documented local ISO datetimes, or local clock times tied to this request.
 const clock=/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
 const time=clock.test(value)?date+'T'+value:value.replace(' ','T');
 if(!time.startsWith(date+'T')||!clock.test(time.slice(11)))throw new Error('Availability time does not match the requested day.');
 return {time,label:time.slice(11,16)};
}
export function openTableSlots(data:unknown,rid:number,party:number,date:string):{label:string;time:string}[]{
 const d=data as {rid?:number;party_size?:number;times?:unknown;times_available?:unknown};
 if(!d||d.rid!==rid||d.party_size!==party||(!Array.isArray(d.times)&&!Array.isArray(d.times_available)))throw new Error('Unexpected OpenTable response.');
 const times=Array.isArray(d.times_available)&&d.times_available.length?d.times_available.map(x=>x?.time):Array.isArray(d.times)?d.times:[];
 return Array.from(new Map(times.map(t=>{const slot=localTime(t,date);return [slot.time,slot] as const;})).values());
}
export function viatorSlots(data:unknown,productCode:string,day:string):{label:string;time?:string}[]{
 const d=data as {productCode?:string;travelDate?:string;bookableItems?:unknown};
 if(!d||d.productCode!==productCode||d.travelDate!==day||!Array.isArray(d.bookableItems)||d.bookableItems.some(x=>!x||typeof x.available!=='boolean'))throw new Error('Unexpected Viator response.');
 return d.bookableItems.filter(x=>x.available===true).map(x=>({label:[typeof x.startTime==='string'?localTime(x.startTime,day).label:'Available on this date',typeof x.productOptionCode==='string'?x.productOptionCode:''].filter(Boolean).join(' · '),...(typeof x.startTime==='string'?{time:x.startTime}:{})}));
}
export function resySlots(data:unknown,url:string,date:string):{label:string;time:string}[]{
 if(!Array.isArray(data)||data.length>1)throw new Error('Unexpected Resy response.');
 // With includeAvailability, the actor omits restaurants with no returned slots.
 // An empty dataset is a valid empty search; it does not verify venue identity.
 if(data.length===0)return [];
 const venue=data[0];
 const normalized=(v:unknown)=>{if(typeof v!=='string')return '';const u=new URL(v);return u.origin+u.pathname.replace(/\/$/,'');};
 if(!venue||normalized(venue.url)!==normalized(url)||!Array.isArray(venue.slots))throw new Error('Resy venue did not match the requested restaurant.');
 return venue.slots.map((s:{startTime?:string})=>localTime(s.startTime,date));
}
