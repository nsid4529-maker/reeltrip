'use client';
import {useEffect,useId,useState} from 'react';
import type {VideoAnalysis} from '@/lib/analysis';
import type {ChatPreferences} from '@/lib/bundle-chat';
import {interestUrl,type Interest} from '@/lib/interested';
import {diningDays} from '@/lib/travel';
import {choiceDates} from '@/lib/saved-choice-links';
import {emptyPreparation,prepareSpecialists,preparationStorageKey,readPreparation,updatePreparation,PREPARATION_CHANGED,specialistLabels,specialistDestinationLinks,type SpecialistKind,type PreparationState} from '@/lib/booking-specialists';
import {SourcePlaceCard,SavedChoiceCard} from './source-place-card';

type Props={preferences:ChatPreferences;analyses:VideoAnalysis[];interests:Interest[];tripId:string;total?:number;specialists?:SpecialistKind[]};
export function SpecialistPreparation(props:Props){return <Preparation key={props.tripId} {...props}/>;}
function Preparation({preferences,analyses,interests,tripId,total=analyses.length,specialists=['hotel','restaurant','activity']}:Props){
 const [state,setState]=useState<PreparationState>(emptyPreparation),[ready,setReady]=useState(false),[error,setError]=useState('');
 const formId=useId();
 useEffect(()=>{
  const refresh=()=>{try{setState(readPreparation(localStorage.getItem(preparationStorageKey(tripId))));setError('');}catch(e){setError((e as Error).message);}finally{setReady(true);}};
  const storage=(event:StorageEvent)=>{if(event.key===null||event.key===preparationStorageKey(tripId))refresh();};
  refresh();window.addEventListener(PREPARATION_CHANGED,refresh);window.addEventListener('storage',storage);window.addEventListener('focus',refresh);
  return()=>{window.removeEventListener(PREPARATION_CHANGED,refresh);window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);};
 },[tripId]);
 function update(patch:Parameters<typeof updatePreparation>[2]){
  try{setState(updatePreparation(localStorage,tripId,patch));setError('');window.dispatchEvent(new Event(PREPARATION_CHANGED));}
  catch(e){setError((e as Error).message||'Could not save preparation notes on this device. Existing notes remain unchanged.');}
 }
 const all=prepareSpecialists({preferences,analyses,interests,state}),cards=all.filter(card=>specialists.includes(card.specialist));
 const dates=choiceDates(preferences),days=dates?diningDays(dates):[],active=preferences.dates[preferences.activeDate];
 const retainedProblems=Object.entries(state.problems).filter(([id])=>!all.some(card=>card.id===id));
 const diningDay=days.includes(state.diningDate)?state.diningDate:days[0]||'';
 return <section className="specialist-preparation" aria-label="Booking preparation">
  <div className="eyebrow">PREPARED FROM YOUR BUCKET</div><h3>{specialists.length===1?specialistLabels[specialists[0]]+' to explore':'Your booking preparation'}</h3>
  <p className="fine-print">These options use {preferences.name}’s attached reel evidence and Interested choices. Ready to open means the handoff is prepared; prices, availability and bookings still need confirmation with the provider.</p>
  <p className="specialist-context">{active?.start||'Dates to decide'}{active?.end?' → '+active.end:''} · {preferences.adults} adults · {preferences.currency}</p>
  {preferences.brief&&<p className="fine-print"><strong>Your preferences:</strong> {preferences.brief}</p>}
  <p className="fine-print">Budget, dietary needs, accessibility and travel time are not guaranteed by these searches. Confirm them with the provider.</p>
  {total>analyses.length&&<p className="specialist-attention" role="status">{total-analyses.length} attached {total-analyses.length===1?'reel is':'reels are'} not ready. Pending or failed sources stay in <a href="/trips?tab=sources">Reels &amp; bundles</a> and are not used here.</p>}
  {specialists.includes('restaurant')&&<fieldset className="specialist-dining" disabled={!ready||!!error}><legend>Requested restaurant slot</legend><label htmlFor={formId+'-day'}>Dining day<select id={formId+'-day'} value={diningDay} disabled={!days.length} onChange={event=>update({diningDate:event.target.value})}>{!days.length&&<option value="">Choose bucket dates first</option>}{days.map(day=><option key={day}>{day}</option>)}</select></label><label htmlFor={formId+'-time'}>Local time<select id={formId+'-time'} value={state.diningTime} onChange={event=>update({diningTime:event.target.value})}><option value="">Choose a local time</option>{Array.from({length:48},(_,i)=>`${String(Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`).map(time=><option key={time}>{time}</option>)}</select></label><p className="fine-print">{preferences.adults} diners · the selected bucket’s guest count. This slot is a request, not a held table.</p></fieldset>}
  {error&&<p className="specialist-attention" role="alert">{error}</p>}
  {!ready?<p role="status">Loading your preparation notes…</p>:<>{specialists.map(specialist=>{
   const options=cards.filter(card=>card.specialist===specialist),fallbacks=specialistDestinationLinks(specialist,preferences,state);
   return <section className="specialist-group" key={specialist} aria-label={specialistLabels[specialist]+' preparation'}><h4>{specialistLabels[specialist]} · {options.length} {options.length===1?'option':'options'}</h4>{!options.length?<div className="specialist-empty"><p>No {specialistLabels[specialist].toLowerCase()} are attached to this bucket yet. Attach a relevant reel or save a place to Interested to prepare options from your own choices.</p>{fallbacks.length>0&&<div className="specialist-handoffs"><h4>Destination searches · no options selected</h4>{fallbacks.map((link,index)=><div key={index}><a className="provider-link" href={link.url} target={link.url.startsWith('/')?undefined:'_blank'} rel={link.url.startsWith('/')?undefined:'noopener noreferrer'}>{link.label}</a><p className="fine-print">{link.notice}</p></div>)}</div>}<a className="secondary" href={specialist==='hotel'?'/travel':specialist==='restaurant'?'/reservations':'/activities'}>Explore {specialistLabels[specialist].toLowerCase()}</a></div>:options.map(card=><div className="specialist-choice" key={card.id}>
    <div className="specialist-status-row"><span className={'specialist-status '+(card.status==='Needs attention'?'needs-attention':card.status==='Ready to open'?'ready':'' )}>{card.status}</span>{card.shortlisted&&<span className="fine-print">In this bucket’s Interested list</span>}</div>
    <dl className="specialist-facts"><div><dt>{specialist==='restaurant'?'Requested slot':'Selected dates'}</dt><dd>{specialist==='restaurant'?(card.meal?card.meal.date+' · '+card.meal.time+' local':'Choose a dining day and local time'):active?.start?(active.start+(active.end?' → '+active.end:'')):'Dates to decide'} · {preferences.adults} {specialist==='restaurant'?'diners':'adults'}</dd></div><div><dt>Price &amp; cancellation</dt><dd>Not checked · confirm with the provider</dd></div></dl>
    {card.problem&&<p className="specialist-attention" role="status">{card.problem} Try another handoff below or <a href="/interested">edit this choice in Interested</a>.</p>}
    {card.missing.length>0&&<p className="fine-print">{card.missing.join(' ')} <a href="/trips?tab=overview">Review bucket settings</a>.</p>}
    {card.match?<SourcePlaceCard match={card.match} source={card.source} preferences={preferences} tripId={tripId} meal={card.meal}/>:card.item&&interestUrl(card.item.url)?<SavedChoiceCard item={card.item} preferences={preferences} tripId={tripId}/>:<h3>{card.title}</h3>}
    {!card.match&&card.links.length>0&&<div className="specialist-handoffs"><h4>Prepared provider handoffs</h4>{card.links.filter(link=>link.label!=='Open original saved provider page').map((link,index)=><div key={link.provider+index}><a className="provider-link" href={link.url} target={link.url.startsWith('/')?undefined:'_blank'} rel={link.url.startsWith('/')?undefined:'noopener noreferrer'}>{link.label}</a><p className="fine-print">{link.notice}</p></div>)}</div>}
    {state.problems[card.id]?<button className="text-button" disabled={!!error} onClick={()=>update({problem:{id:card.id,reason:null}})}>Clear my follow-up note</button>:<details className="specialist-report"><summary>Keep a problem with this option</summary><p className="fine-print">This records your report. It does not verify a provider failure or remove the option.</p>{['Provider page did not open','No suitable option was shown','Price or details differed on the provider'].map(reason=><button className="secondary" disabled={!!error} key={reason} onClick={()=>update({problem:{id:card.id,reason:card.title+': '+reason}})}>{reason}</button>)}</details>}
   </div>)}</section>;
  })}{retainedProblems.length>0&&<section className="specialist-attention" aria-label="Retained follow-up notes"><h4>Notes for options no longer attached</h4><p>These options are no longer in this bucket’s current sources or Interested list. Your reports are kept until you clear them.</p>{retainedProblems.map(([id,reason])=><div key={id}><p>{reason}</p><button className="text-button" disabled={!!error} onClick={()=>update({problem:{id,reason:null}})}>Clear this follow-up note</button></div>)}</section>}<p className="fine-print">Shortlist with + Interested. Preparation notes stay in this bucket on this device. Flights remain Skyscanner searches in <a href="/travel">Flights &amp; hotels</a>.</p></>}
 </section>;
}
