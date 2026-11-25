import {boundedJSON} from '../http-safety.ts';
import {fixtureProvider} from './fixture.ts';

// A places provider finds candidate venues for a name and area, and fetches
// one venue's details by id. Google's terms (Service Specific Terms 14, Oct
// 2026) let ReelTrip store place IDs indefinitely. Coordinates, names,
// addresses and Maps links are used live and never persisted by ReelTrip.
export type Candidate={id:string;name:string;address:string;lat:number|null;lng:number|null};
export type PlaceDetails=Candidate&{mapsUri:string};
export type ProviderName='google'|'fixture';
export interface PlacesProvider{name:ProviderName;search(textQuery:string):Promise<Candidate[]>;details(id:string):Promise<PlaceDetails|null>}
export class ProviderError extends Error{reason:'busy'|'unavailable';constructor(reason:'busy'|'unavailable'){super(reason==='busy'?'The places service is busy. Try again shortly.':'The places service is unavailable right now.');this.reason=reason;}}

export const PLACE_ID=/^[A-Za-z0-9_-]{10,300}$/;
// Cheapest field masks that cover what the card shows. No opening hours,
// ratings, photos or reviews: those are higher-priced fields.
export const SEARCH_FIELDS='places.id,places.displayName,places.formattedAddress';
export const DETAILS_FIELDS='id,displayName,formattedAddress,location,googleMapsUri';

const coordinate=(value:unknown,limit:number)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit?value:null;
const text=(value:unknown,max:number)=>typeof value==='string'?value.slice(0,max):'';
function place(raw:Record<string,unknown>):Candidate|null{
 const id=text(raw.id,300);if(!PLACE_ID.test(id))return null;
 const location=raw.location as {latitude?:unknown;longitude?:unknown}|undefined;
 return {id,name:text((raw.displayName as {text?:unknown})?.text,200),address:text(raw.formattedAddress,300),lat:coordinate(location?.latitude,90),lng:coordinate(location?.longitude,180)};
}

export function googleProvider(key:string,fetcher:typeof fetch=fetch):PlacesProvider{
 async function call(url:string,init:RequestInit):Promise<Record<string,unknown>|null>{
  let response:Response;
  // The key travels in a header, never in a URL, and is never echoed back.
  try{response=await fetcher(url,{...init,headers:{...init.headers as Record<string,string>,'X-Goog-Api-Key':key},signal:AbortSignal.timeout(8000),redirect:'manual'});}
  catch{throw new ProviderError('unavailable');}
  if(response.status===404)return null;
  if(!response.ok)throw new ProviderError(response.status===429?'busy':'unavailable');
  try{return await boundedJSON<Record<string,unknown>>(response,200000);}catch{throw new ProviderError('unavailable');}
 }
 return {
  name:'google',
  async search(textQuery){
   const data=await call('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-FieldMask':SEARCH_FIELDS},body:JSON.stringify({textQuery:textQuery.slice(0,200),pageSize:5,languageCode:'en'})});
   const places=Array.isArray(data?.places)?data.places as Record<string,unknown>[]:[];
   return places.map(place).filter((p):p is Candidate=>!!p).slice(0,5);
  },
  async details(id){
   if(!PLACE_ID.test(id))return null;
   const data=await call('https://places.googleapis.com/v1/places/'+encodeURIComponent(id),{method:'GET',headers:{'X-Goog-FieldMask':DETAILS_FIELDS}});
   const found=data?place(data):null;if(!found)return null;
   const mapsUri=text(data!.googleMapsUri,500);
   return {...found,mapsUri:/^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl)\//.test(mapsUri)?mapsUri:''};
  },
 };
}

// Google when its key is set (server secret). The fixture is test data and is
// used only when explicitly turned on, so missing keys never show sample venues.
export function placesProvider(env:Record<string,string|undefined>,fetcher:typeof fetch=fetch):PlacesProvider|null{
 const key=env.GOOGLE_PLACES_API_KEY?.trim();
 if(key&&/^[A-Za-z0-9_-]{20,100}$/.test(key))return googleProvider(key,fetcher);
 if(env.PLACES_PROVIDER==='fixture')return fixtureProvider();
 return null;
}
