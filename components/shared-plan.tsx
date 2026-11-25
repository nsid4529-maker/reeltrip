'use client';
import {useMemo,useState} from 'react';
import {CalendarDays} from 'lucide-react';
import {generateSharedPlan,sharedPlaceAnchor,type PlanChoice} from '@/lib/shared-plan';
import type {SharedBucket} from '@/lib/shared-client';
import {tripDates} from '@/lib/handoff';

const dateLabel=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
function ChoiceLinks({choices,onRevealChoice}:{choices:PlanChoice[];onRevealChoice?:(id:string)=>void}){
 return <ul>{choices.map(({place})=><li key={place.id}><a href={'#'+encodeURIComponent(sharedPlaceAnchor(place.id))} onClick={event=>{if(onRevealChoice){event.preventDefault();onRevealChoice(place.id);}}}>{place.title}</a><span> · {place.place}</span></li>)}</ul>;
}
export function SharedTripPlan({bucket,onRevealChoice}:{bucket:SharedBucket;onRevealChoice?:(id:string)=>void}){
 const [opened,setOpened]=useState(false),plan=useMemo(()=>generateSharedPlan(bucket),[bucket]);
 const itinerary=plan.itinerary,needsVotes=!!bucket.trip.start&&!!bucket.trip.end&&!plan.kept.some(c=>c.place.category==='Experiences'||c.place.category==='Food');
 return <section className="shared-plan" aria-labelledby="shared-plan-heading">
  <div className="shared-plan-heading"><div><div className="eyebrow">FROM YOUR GROUP’S CHOICES</div><h2 id="shared-plan-heading">Your trip plan</h2></div><CalendarDays size={24} aria-hidden="true"/></div>
  <p>Turn your Keep and Skip votes into a day-by-day draft for your dates.</p>
  <p className="fine-print">Uses places with more Keep than Skip votes. Ties and places nobody has voted on stay out until you decide.</p>
  {plan.reason?<p className="place-notice" role="status">{plan.reason} <a href={needsVotes?'#shared-reels-heading':'#shared-trip-heading'}>{needsVotes?'Review your choices':'Set trip dates'}</a></p>:
   <button type="button" className="primary" aria-expanded={opened} aria-controls="shared-plan-days" onClick={()=>setOpened(v=>!v)}>{opened?'Hide trip plan':'Generate trip plan'}</button>}
  {opened&&itinerary&&<div id="shared-plan-days">
   <p className="shared-plan-summary" role="status">{tripDates(bucket.trip.start,bucket.trip.end)} · {bucket.trip.travellers} {bucket.trip.travellers===1?'traveller':'travellers'} · Updates with your saved dates and votes.</p>
   <p className="fine-print">Arrival and departure stay flexible. Up to two kept stops per full day; extra ideas remain below. Day order is a suggestion: check travel distances, opening hours and availability. Nothing is booked.</p>
   {bucket.reels.some(r=>r.status==='analysing'||(r.omittedDetails||0)>0)&&<p className="place-notice">Some reel analysis is still processing or incomplete. This draft uses the saved places available now.</p>}
   <ol className="shared-plan-days">{itinerary.days.map((day,index)=><li key={day.date}>
    <div className="shared-plan-day-title"><h3>Day {index+1}</h3><time dateTime={day.date}>{dateLabel(day.date)}</time></div>
    <ol className="shared-plan-stops">{day.stops.map((stop,i)=>{
     const choice=plan.kept.find(c=>c.place.id===stop.matchId);
     return <li key={stop.matchId||i}><span className="shared-plan-period">{stop.period}</span><div><strong>{stop.title}</strong>
      {choice?<><p>{choice.place.place}</p><a href={'#'+encodeURIComponent(sharedPlaceAnchor(choice.place.id))} onClick={event=>{if(onRevealChoice){event.preventDefault();onRevealChoice(choice.place.id);}}}>View reel evidence &amp; booking options</a></>:<p>{stop.detail}</p>}
     </div></li>;
    })}</ol>
   </li>)}</ol>
   {plan.unscheduled.length>0&&<div className="shared-plan-extra"><h3>Kept, still to fit in</h3><p>These need more full days or a timing check. Change the dates or votes to adjust the draft.</p><ChoiceLinks choices={plan.unscheduled} onRevealChoice={onRevealChoice}/></div>}
   {plan.logistics.length>0&&<div className="shared-plan-extra"><h3>Stays and transport to arrange</h3><p>Kept by your group; dates, routes and reservations still need confirming.</p><ChoiceLinks choices={plan.logistics} onRevealChoice={onRevealChoice}/></div>}
   {plan.undecided.length>0&&<div className="shared-plan-extra"><h3>Decide together</h3><p>Keep and Skip are tied, so these aren’t in the draft.</p><ChoiceLinks choices={plan.undecided} onRevealChoice={onRevealChoice}/></div>}
   <p className="fine-print">{plan.skipped} {plan.skipped===1?'place has':'places have'} more Skip than Keep votes and {plan.skipped===1?'is':'are'} excluded. This is a planning suggestion based on reel analysis, which may contain mistakes.</p>
  </div>}
 </section>;
}
