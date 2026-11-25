'use client';
import {useEffect,useId,useState} from 'react';
import {TRIPS_KEY,TRIPS_CHANGED,loadTrips,createTrip,selectTrip,updateTrip,removeTrip,assignTripInterest,changeTripReferences,type TripReferenceField,type TripBucket,type TripPatch,type TripStore} from '@/lib/trip-buckets';
const empty:TripStore={version:1,trips:[],activeId:null};
export function useTrips(){
 const [state,setState]=useState<TripStore>(empty),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  function refresh(){try{setState(loadTrips(window.localStorage));setError('');}catch{setError('Your trip buckets could not be read on this device. Existing data has been kept unchanged.');}finally{setReady(true);}}
  function onStorage(event:StorageEvent){if(event.key===TRIPS_KEY||event.key===null)refresh();}
  refresh();window.addEventListener(TRIPS_CHANGED,refresh);window.addEventListener('storage',onStorage);window.addEventListener('focus',refresh);
  return ()=>{window.removeEventListener(TRIPS_CHANGED,refresh);window.removeEventListener('storage',onStorage);window.removeEventListener('focus',refresh);};
 },[]);
 function mutate(action:()=>TripStore):TripStore|null{
  try{const next=action();setState(next);setError('');window.dispatchEvent(new Event(TRIPS_CHANGED));return next;}
  catch(e){setError(e instanceof Error&&/trip|date|reference|places|unchanged/i.test(e.message)?e.message:'Could not save your trip on this device. Check browser storage and try again.');return null;}
 }
 return {trips:state.trips,activeId:state.activeId,activeTrip:state.trips.find(t=>t.id===state.activeId)||null,ready,error,
  create:(name:string,destination=''):TripBucket|null=>{const next=mutate(()=>createTrip(window.localStorage,name,destination));return next?.trips.find(t=>t.id===next.activeId)||null;},
  select:(id:string)=>!!mutate(()=>selectTrip(window.localStorage,id)),
  update:(id:string,patch:TripPatch)=>!!mutate(()=>updateTrip(window.localStorage,id,patch)),
  references:(tripId:string,field:TripReferenceField,ids:string[],include:boolean)=>!!mutate(()=>changeTripReferences(window.localStorage,tripId,field,ids,include)),
  remove:(id:string)=>!!mutate(()=>removeTrip(window.localStorage,id)),
  assignInterest:(interestId:string,include:boolean,tripId?:string)=>!!mutate(()=>assignTripInterest(window.localStorage,interestId,include,tripId))};
}
export function TripPicker({className=''}:{className?:string}){
 const trips=useTrips(),id=useId();
 return <div className={'trip-picker '+className}><label htmlFor={id}>Bucket<select id={id} aria-label="Selected bucket" aria-describedby={trips.error?id+'-error':undefined} disabled={!trips.ready} value={trips.activeId||''} onChange={e=>trips.select(e.target.value)}><option value="">No bucket selected</option>{trips.trips.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{trips.error&&<p id={id+'-error'} className="interest-error" role="alert">{trips.error}</p>}</div>;
}
