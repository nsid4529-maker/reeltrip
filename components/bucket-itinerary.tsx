'use client';
import {useEffect,useState} from 'react';
import {CalendarDays} from 'lucide-react';
import type {TripBucket} from '@/lib/trip-buckets';
import type {Interest} from '@/lib/interested';
import {tripChatPreferences} from '@/lib/trip-planning';
import {tripDateLabel} from '@/lib/trip-display';
import {assignBucketChoice,bucketItineraryDays,bucketItineraryKey,readBucketItinerary,saveBucketDayNote,type BucketChoicePlan} from '@/lib/bucket-itinerary';
import {SavedChoiceCard} from './source-place-card';

const itineraryDay=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const dayLabel=(day:string)=>itineraryDay.format(new Date(day+'T00:00:00Z'));
type Props={trip:TripBucket;interests:Interest[]};
export function BucketItineraryChoices(props:Props){return <ChoiceItinerary key={props.trip.id} {...props}/>;}

function DayNote({day,value,save}:{day:string;value:string;save:(note:string)=>boolean}){
 const [note,setNote]=useState(value),[saved,setSaved]=useState(false);
 useEffect(()=>setNote(value),[value]);
 return <form className="bucket-choice-note" onSubmit={event=>{event.preventDefault();if(save(note))setSaved(true);}}><label>Notes for this day<textarea value={note} maxLength={3000} rows={2} aria-label={'Notes for '+dayLabel(day)} onChange={event=>{setNote(event.target.value);setSaved(false);}} placeholder="Your ideas, timing to check, or a reminder…"/></label><div><button type="submit" className="secondary">Save day notes</button>{saved&&<span role="status">Saved on this device.</span>}</div></form>;
}

function ChoiceItinerary({trip,interests}:Props){
 const [plan,setPlan]=useState<BucketChoicePlan>({version:1,assignments:[],notes:[]}),[ready,setReady]=useState(false),[readBlocked,setReadBlocked]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  function refresh(){try{setPlan(readBucketItinerary(localStorage.getItem(bucketItineraryKey(trip.id))));setReadBlocked(false);setError('');}catch(e){setReadBlocked(true);setError(e instanceof Error?e.message:'Your saved itinerary could not be read. Existing data has been kept unchanged.');}finally{setReady(true);}}
  function storage(event:StorageEvent){if(event.key===null||event.key===bucketItineraryKey(trip.id))refresh();}
  refresh();window.addEventListener('storage',storage);window.addEventListener('focus',refresh);
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);};
 },[trip.id]);
 let days:string[]=[],dateError='';try{days=bucketItineraryDays(trip.dates[trip.activeDate]);}catch(e){dateError=(e as Error).message;}
 const items=interests.filter(item=>trip.interestIds.includes(item.id));
 const assignments=new Map(plan.assignments.map(row=>[row.interestId,row.date]));
 const unscheduled=items.filter(item=>!assignments.has(item.id));
 const previousDates=[...new Set([...plan.assignments.map(row=>row.date),...plan.notes.map(row=>row.date)])].filter(day=>!days.includes(day)).sort();
 const missing=plan.assignments.filter(row=>!items.some(item=>item.id===row.interestId));
 const preferences=tripChatPreferences(trip);
 function change(action:()=>BucketChoicePlan,message=''){
  try{setPlan(action());setError('');setNotice(message);return true;}
  catch(e){setError(e instanceof Error?e.message:'This itinerary could not be saved. Your previous data has been kept.');return false;}
 }
 function choice(item:Interest){
  const assigned=assignments.get(item.id)||'';
  const datedPreferences=assigned&&(item.kind==='activity'||item.kind==='restaurant')?{...preferences,dates:[{start:assigned,end:assigned}],activeDate:0}:preferences;
  return <div className="bucket-choice-item" key={item.id}><SavedChoiceCard item={item} tripId={trip.id} preferences={datedPreferences}/><label className="bucket-choice-day-picker">Day in your draft<select aria-label={'Planned day for '+item.title} value={assigned} onChange={event=>{const day=event.target.value;change(()=>assignBucketChoice(localStorage,trip.id,item.id,day),day?'Choice assigned to '+dayLabel(day)+'. This is still a draft.':'Choice kept in your unscheduled shortlist.');}}><option value="">Not assigned to a day</option>{assigned&&!days.includes(assigned)&&<option value={assigned}>{dayLabel(assigned)} · outside current dates</option>}{days.map((day,index)=><option key={day} value={day}>Day {index+1} · {dayLabel(day)}</option>)}</select></label></div>;
 }
 function daySection(day:string,index?:number){
  const assigned=items.filter(item=>assignments.get(item.id)===day),note=plan.notes.find(row=>row.date===day)?.text||'';
  return <details className="bucket-choice-day" key={day} open={assigned.length>0||!!note||index===0}><summary><CalendarDays size={17} aria-hidden="true"/><span>{index===undefined?'Previous date':'Day '+(index+1)} · {dayLabel(day)}</span><small>{assigned.length} {assigned.length===1?'choice':'choices'}</small></summary>{assigned.length?<div className="bucket-choice-grid">{assigned.map(choice)}</div>:<p className="fine-print">No currently attached choices assigned to this day.</p>}<DayNote day={day} value={note} save={text=>change(()=>saveBucketDayNote(localStorage,trip.id,day,text))}/></details>;
 }
 return <section className="bucket-choice-plan" aria-label="Interested choices in your itinerary"><div className="bucket-choice-heading"><div><div className="eyebrow">YOUR CHOICES, YOUR DAYS</div><h2>Make room for your favourites.</h2></div><span className="draft-badge">DRAFT · NOT BOOKED</span></div><p>Assign your Interested choices to a day, then add your own notes. These are your saved choices, not verified reel evidence or confirmed reservations.</p><p className="bucket-choice-context">{tripDateLabel(trip.dates[trip.activeDate])} · {trip.adults} {trip.adults===1?'adult':'adults'} · {trip.currency} <a href="/trips?tab=overview">Edit dates &amp; guests</a></p><p className="fine-print">One proposed day per choice. Check travel time, opening hours, dates and guests with the provider. Hotel and flight searches keep the bucket’s full date range.</p>
  {error&&<p role="alert" className="interest-error">{error}</p>}{notice&&<p role="status" className="bucket-choice-status">{notice}</p>}
  {!ready?<p role="status">Loading your day assignments…</p>:!readBlocked&&<>
   {(dateError||!days.length)&&<p className="bucket-choice-warning">{dateError||'Choose your trip dates in Overview to assign choices to days. Your shortlist is ready below.'} <a href="/trips?tab=overview">Set bucket dates</a></p>}
   {!items.length&&<p className="trip-empty-message">Add places, activities, stays or flight searches to this bucket’s <a href="/interested">Interested list</a>. You can plan them here without attaching a reel.</p>}
   {unscheduled.length>0&&<div className="bucket-choice-unscheduled"><h3>Not assigned to a day · {unscheduled.length}</h3><div className="bucket-choice-grid">{unscheduled.map(choice)}</div></div>}
   <div className="bucket-choice-days">{days.map((day,index)=>daySection(day,index))}</div>
   {previousDates.length>0&&<section className="bucket-choice-previous" aria-label="Assignments outside the current dates"><h3>Outside your current dates</h3><p>Your dates changed. These assignments and notes are still saved. Choose a new day for each choice, or leave it unscheduled.</p>{previousDates.map(day=>daySection(day))}</section>}
   {missing.length>0&&<details className="bucket-choice-missing"><summary>{missing.length} assignments for choices no longer in this bucket</summary><p>These references remain saved in case you add the choices back. Clearing an assignment does not delete the original saved choice or any day notes.</p>{missing.map((row,index)=><div key={row.interestId}><span>Detached choice {index+1} · {dayLabel(row.date)}</span><button type="button" className="text-button" onClick={()=>change(()=>assignBucketChoice(localStorage,trip.id,row.interestId,''),'Detached assignment cleared.')}>Clear assignment</button></div>)}</details>}
  </>}
 </section>;
}
