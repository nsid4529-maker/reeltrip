'use client';
import {itineraryMealTime} from '@/lib/itinerary';
import {useEffect,useRef,useState} from 'react';
import {CalendarDays,ArrowUpRight,Download,Film,MapPin,CheckCircle2} from 'lucide-react';
import catalog from '@/lib/catalog.json';
import type {VideoAnalysis} from '@/lib/analysis';
import {recordActivity} from '@/lib/activity';
import {matches,accommodationMatches,diningSelection,type Trip} from '@/lib/travel';
import {generateItinerary,itinerarySignature,type Base,type Itinerary} from '@/lib/itinerary';
import {ProviderLinks} from './provider-links';
import {itineraryStorageKey,ITINERARY_CHANGED,readSavedItinerary,loadSavedItinerary,editSavedItinerary,replaceSavedItinerary,type ItinerarySnapshot} from '@/lib/itinerary-storage';
export function ItineraryView({trip,run,onSource,onGenerate,onGenerated,analysis,scopeId}:{trip:Trip;run:number;onSource:(id:string)=>void;onGenerate:()=>void;onGenerated?:()=>void;analysis?:VideoAnalysis|VideoAnalysis[];scopeId?:string}){
 const key=itineraryStorageKey(scopeId);
 const collection=analysis?(Array.isArray(analysis)?analysis:[analysis]):[];
 const allMatches=analysis?collection.flatMap(a=>a.matches):matches;
 const sourceTitle=(id:string)=>collection.find(a=>a.source.id===id)?.source.title||catalog.find(s=>s.id===id)?.title||id;
 const [base,setBase]=useState<Base>('auto'),[draft,setDraft]=useState<Itinerary|null>(null),[notes,setNotes]=useState<Record<string,string>>({}),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const [storageError,setStorageError]=useState(''),[unsaved,setUnsaved]=useState(false);
 const snapshot=useRef<ItinerarySnapshot>({raw:null,record:readSavedItinerary(null)});
 const edits=useRef<{notes:Record<string,string>;base?:Base}>({notes:{}}),replacement=useRef<{draft:Itinerary;base:Base}|null>(null),baseSelection=useRef<Base>('auto');
 function acceptSaved(next:ItinerarySnapshot){snapshot.current=next;setDraft(next.record.draft);setNotes(next.record.notes);setBase(next.record.base);baseSelection.current=next.record.base;edits.current={notes:{}};replacement.current=null;setUnsaved(false);setStorageError('');}
 function loadSaved(){try{if(!key)throw new Error('Invalid itinerary scope. Existing saved data has been kept.');acceptSaved(loadSavedItinerary(localStorage,key));}catch(error){setStorageError(error instanceof Error?error.message:'Your saved itinerary could not be read. Existing data has been kept.');}}
 useEffect(()=>{
  function refresh(){
   try{
    if(!key)throw new Error('Invalid itinerary scope. Existing saved data has been kept.');
    const latest=loadSavedItinerary(localStorage,key);
    if(replacement.current||Object.keys(edits.current.notes).length||edits.current.base!==undefined){
     if(latest.raw!==snapshot.current.raw)setStorageError('Another tab changed the saved itinerary. Your unsaved changes are kept here; export them or load the saved version.');
     return;
    }
    acceptSaved(latest);
   }catch(error){setStorageError(error instanceof Error?error.message:'Your saved itinerary could not be read. Existing data has been kept.');}
   finally{setLoaded(true);}
  }
  const storage=(event:StorageEvent)=>{if(event.key===null||event.key===key)refresh();};
  refresh();window.addEventListener('storage',storage);window.addEventListener('focus',refresh);window.addEventListener(ITINERARY_CHANGED,refresh);
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);window.removeEventListener(ITINERARY_CHANGED,refresh);};
 },[key]);
 function saveChanges(){
  try{
   if(!key)throw new Error('Invalid itinerary scope. Existing saved data has been kept.');
   const next=replacement.current?replaceSavedItinerary(localStorage,key,snapshot.current,replacement.current.draft,replacement.current.base,edits.current.notes):editSavedItinerary(localStorage,key,snapshot.current,edits.current);
   acceptSaved(next);window.dispatchEvent(new Event(ITINERARY_CHANGED));
  }catch(error){setUnsaved(true);setStorageError(error instanceof Error&&/saved itinerary|another tab|scope/.test(error.message)?error.message:'This itinerary could not be saved on this device. Your changes are kept here; retry saving or export the draft.');}
 }
 function changeNote(day:string,value:string){
  const note=value.slice(0,3000);setNotes(current=>({...current,[day]:note}));edits.current.notes[day]=note;
  saveChanges();
 }
 function changeBase(value:Base){baseSelection.current=value;setBase(value);edits.current.base=value;if(replacement.current)replacement.current.base=value;saveChanges();}
 // Consume each explicit generation once; merely restoring a draft never writes.
 useEffect(()=>{if(run>0)try{const next=generateItinerary(trip,analysis?'auto':baseSelection.current,analysis);setDraft(next);setNotes({});edits.current={notes:{}};replacement.current={draft:next,base:baseSelection.current};setError('');saveChanges();recordActivity('itineraries');}catch(error){setError((error as Error).message);}finally{onGenerated?.();}},[run]);
 const stale=!!draft&&draft.signature!==itinerarySignature(trip,analysis?'auto':base,analysis);
 function download(){if(!draft)return;const content={itinerary:draft,personalNotes:notes,inputsChanged:stale,availability:'not_verified'};const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='reeltrip-full-itinerary.json';a.click();URL.revokeObjectURL(url);}
 const stay=allMatches.find(m=>m.id===draft?.stayId&&draft?.includedSources.includes(m.source));
 const stays=accommodationMatches(allMatches,analysis?collection.map(a=>a.source.id):trip.selected);
 return <section className="itinerary-section" aria-label="Full itinerary"><div className="section-heading"><div><div className="eyebrow">03 · YOUR FULL ITINERARY</div><h2>From inspiration to a day-by-day plan</h2><p>Arrival, activities, meal breaks, accommodation searches and departure — with the evidence alongside.</p></div>{draft&&<button className="secondary" onClick={download}><Download size={15}/>Export itinerary</button>}</div><div className="itinerary-controls">{!analysis&&<label>Trip base<select aria-label="Itinerary base" value={base} onChange={e=>changeBase(e.target.value as Base)}><option value="auto">Best fit for my videos & brief</option><option value="ella">Ella</option><option value="sigiriya">Sigiriya</option><option value="coast">Ahangama & south coast</option></select></label>}<button className="primary" disabled={!loaded} onClick={onGenerate}>{draft?'Regenerate itinerary':'Generate full itinerary'}<ArrowUpRight size={15}/></button></div>{error&&<p className="inline-message" role="alert">{error}</p>}{storageError&&<div className="inline-message" role="alert"><p>{storageError}</p><div className="state-actions">{unsaved&&<button className="secondary" onClick={saveChanges}>Retry saving changes</button>}<button className="text-button" onClick={loadSaved}>Load saved version</button></div></div>}{stale&&<p className="inline-message" role="status">Your trip settings or base changed. This is the previous draft; regenerate to use the current videos and dates. Regenerating clears personal day notes.</p>}
 {!draft?<div className="itinerary-empty"><CalendarDays size={26}/><h3>Your videos already tell a story.</h3><p>Open a reel, review its breakdown, then choose dates to generate your draft.</p></div>:<><div className="itinerary-overview"><MapPin size={22}/><div><h3>{draft.base}</h3><p>{draft.days.length} calendar days · {draft.nights} nights · {draft.days[0].date} → {draft.days.at(-1)?.date}</p></div><span className="draft-badge">DRAFT · CHECK BEFORE BOOKING</span></div><div className="itinerary-coverage"><strong>Source coverage</strong><p>{draft.includedSources.map(id=>sourceTitle(id)).join(' · ')}</p>{draft.otherSources.length>0&&<p>Other regional videos kept as alternatives: {draft.otherSources.map(id=>sourceTitle(id)).join(' · ')}</p>}</div>
 <div className="itinerary-stay"><strong>Accommodation from your selected reels</strong><p>{stay?'Suggested base: '+stay.title+'. Confirm its suitability for your plans.':stays.length?'These stays may be in different areas. Choose the nights for each stop; no single base has been assumed.':'No specific accommodation is established by the selected videos. Choose and confirm your own stay.'}</p>{stays.map(option=><div className="itinerary-stay-option" key={option.source+':'+option.id}><h4>{option.title} · {option.place}</h4><p>{option.note||option.kind}</p><button className="evidence-link" onClick={()=>onSource(option.source)}><Film size={12}/>Video evidence · {Math.floor(option.second/60)}:{String(Math.floor(option.second%60)).padStart(2,'0')}</button>{!stale&&<ProviderLinks match={option} dates={trip.dates[trip.activeDate]} adults={trip.adults} currency={trip.currency}/>}</div>)}{stays.length>1&&<p className="fine-print">Search links use the full selected trip window. Adjust the dates on the provider for each stay.</p>}</div>
 <div className="itinerary-days">{draft.days.map((day,index)=><article className="itinerary-day" key={day.date}><header><span className="day-number">{String(index+1).padStart(2,'0')}</span><div><p>{new Date(day.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</p><h3>{day.title}</h3></div></header><div className="day-timeline">{day.stops.map((stop,i)=>{const match=allMatches.find(m=>m.id===stop.matchId);return <div className="itinerary-stop" key={i}><span className="period">{stop.period}</span><div><h4>{stop.title}</h4><p>{stop.detail}</p>{stop.source?<button className="evidence-link" onClick={()=>onSource(stop.source!)}><Film size={12}/>Video evidence · {Math.floor((stop.second||0)/60)}:{String(Math.floor((stop.second||0)%60)).padStart(2,'0')}</button>:<small className="planning-label">Planning suggestion · not a video claim</small>}{stop.alsoSources?.map(e=><button key={e.source} className="evidence-link" onClick={()=>onSource(e.source)}><Film size={12}/>Also in {sourceTitle(e.source)} · {Math.floor(e.second/60)}:{String(Math.floor(e.second%60)).padStart(2,'0')}</button>)}{match&&!stale&&<ProviderLinks match={match} dates={trip.dates[trip.activeDate]} adults={trip.adults} currency={trip.currency} meal={{...diningSelection(trip),date:day.date,time:itineraryMealTime(stop.period,diningSelection(trip).time)}}/>}</div></div>;})}</div><label className="day-notes">Your day notes<textarea aria-label={'Notes for day '+(index+1)} placeholder="Add transfer details, reservations or changes to this day…" value={notes[day.date]||''} onChange={e=>changeNote(day.date,e.target.value)}/></label></article>)}</div><details className="itinerary-checks" open><summary><CheckCircle2 size={17}/>Before this becomes your booked trip</summary><ul>{draft.warnings.map(w=><li key={w}>{w}</li>)}</ul><p>Verified restaurant links use the day shown, your diner count and a suggested meal time (09:00 breakfast/morning / 13:00 lunch/afternoon / your selected time in the evening). Confirm these on OpenTable or SevenRooms. No table is reserved.</p></details></>}
 </section>;
}
