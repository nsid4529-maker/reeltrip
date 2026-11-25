'use client';
import {useEffect,useRef,useState} from 'react';
import {diningSelection,type Match,type Trip} from '@/lib/travel';
import type {AvailabilityResult} from '@/lib/availability';
import {localTimeZone} from '@/lib/calendar-day';
const labels:Record<string,string>={available:'Available now',unavailable:'No times returned',setup_required:'Not connected',mapping_required:'Match needed',access_denied:'Access needed',provider_error:'Could not check'};
export function AvailabilityPanel({trip,matches,run,applied,analysisId,analysisIds}:{trip:Trip;matches:Match[];run:number;applied:boolean;analysisId?:string;analysisIds?:string[]}){
 const [results,setResults]=useState<AvailabilityResult[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(!applied){controller.current?.abort();request.current++;setResults([]);setBusy(false);return;}
  if(!run)return;
  const id=++request.current,c=new AbortController();controller.current=c;setBusy(true);setResults([]);setError('');const timer=setTimeout(()=>c.abort(),180000);
  const meal=diningSelection(trip);
  void (async()=>{
   const collected:AvailabilityResult[]=[];
   try{
    for(let offset=0;offset<matches.length;offset+=16){
     const r=await fetch('/api/availability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchIds:matches.slice(offset,offset+16).map(m=>m.id),analysisId,analysisIds,dates:trip.dates[trip.activeDate],day:meal.date,adults:trip.adults,currency:trip.currency,dining:meal,timeZone:localTimeZone()}),signal:AbortSignal.any([c.signal,AbortSignal.timeout(35000)])});
     const d=await r.json() as {error?:string;results?:AvailabilityResult[]};if(!r.ok||!Array.isArray(d.results))throw new Error(d.error||'Availability could not be checked.');
     if(id!==request.current)return;
     collected.push(...d.results);setResults([...collected]);
    }
   }catch(e){if(id===request.current)setError((collected.length?'Some places were checked. Remaining places could not be checked. ':'')+(c.signal.aborted||(e as Error).name==='TimeoutError'?'The check timed out. Please try again.':(e as Error).message));}
   finally{clearTimeout(timer);if(id===request.current)setBusy(false);}
  })();
  return()=>{clearTimeout(timer);c.abort();};
 },[run,applied]);
 if(!run)return null;
 if(!applied)return <p className="inline-message">Dates or party details changed. Check availability again for the new details.</p>;
 return <section className="availability-panel" aria-label="Live availability results"><h3>Availability for {diningSelection(trip).date}</h3><p>Activity options and restaurant times for your selected day. An unavailable connection does not mean a venue is sold out.</p>{busy&&<p role="status">Checking provider connections and availability{matches.length>16?' in batches':''}…</p>}{!matches.length&&<p>No named venues or activities are available to check for this breakdown.</p>}{error&&<p role="alert">{error}</p>}{results.map((r,i)=><article className="availability-result" key={r.matchId+r.provider+i}><div><h4>{matches.find(m=>m.id===r.matchId)?.title} · {r.provider}</h4><p>{r.message}</p>{r.slots.length>0&&<div className="slot-list">{r.slots.map((s,i)=><span key={i}>{s.label}</span>)}</div>}{r.checkedAt&&<small>Checked {new Date(r.checkedAt).toLocaleTimeString('en-GB')} · Availability can change.</small>}</div><span className={'availability-status '+(r.status==='available'&&r.environment!=='sandbox'?'live':'')}>{r.environment==='sandbox'?'Sandbox test':r.thirdParty&&r.status==='available'?'Reported available':labels[r.status]}</span></article>)}{results.length>0&&results.every(r=>r.status==='setup_required')&&<p className="inline-message">Live provider access is still being connected. Your reel breakdown and itinerary remain usable. There are no confirmed tables, tickets or room results yet.</p>}</section>;
}
