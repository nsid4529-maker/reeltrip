import {validateDates,type Trip} from './travel.ts';
export const GUEST_TRIP_KEY='reeltrip-guest-v1';
export type TripPreferences=Pick<Trip,'dates'|'activeDate'|'adults'|'currency'>;
function guestRecord(raw:string|null):Record<string,unknown>{
 if(raw===null)return {};
 if(raw.length>1000000)throw new Error('Saved trip data is too large.');
 const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Saved trip data could not be read.');return value;
}
export function readTripPreferences(raw:string|null):TripPreferences{
 const record=guestRecord(raw),trip=record.trip as Partial<Trip>|undefined;
 let dates=[{start:'',end:''}];
 if(Array.isArray(trip?.dates)&&trip.dates.length>0&&trip.dates.length<=3){
  dates=trip.dates.map(d=>{try{validateDates([d]);return {start:d.start,end:d.end};}catch{return {start:'',end:''};}});
 }
 return {dates,activeDate:Number.isInteger(trip?.activeDate)&&trip!.activeDate!>=0&&trip!.activeDate!<dates.length?trip!.activeDate!:0,
  adults:Number.isInteger(trip?.adults)&&trip!.adults!>=1&&trip!.adults!<=8?trip!.adults!:2,currency:['GBP','EUR','USD','INR'].includes(trip?.currency||'')?trip!.currency!:'GBP'};
}
export function withTripPreferences(raw:string|null,prefs:TripPreferences):string{
 const record=guestRecord(raw),old=record.trip;
 const trip=old&&typeof old==='object'&&!Array.isArray(old)?old:{};
 // Only update preferences; keep library selections, prompts and saved places.
 return JSON.stringify({...record,trip:{...trip,dates:prefs.dates,activeDate:prefs.activeDate,adults:prefs.adults,currency:prefs.currency}});
}
