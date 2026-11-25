'use client';
import {GetYourGuideOptions} from './getyourguide-options';
import {InterestedButton} from './interested';
import {useEffect,useId,useRef,useState} from 'react';
import {browseProviderUrl,type Match,type Trip,type Window} from '@/lib/travel';
import {loadViatorCatalog,viatorCatalogRequest,type ViatorCatalogResults,type ViatorDestinationRequired} from '@/lib/viator-results';
import {activitySearchQuery,activityTermsAfterLocationChange} from '@/lib/activity-context';

export function ViatorResults({trip,matches}:{trip:Trip;matches:Match[]}){
 const [selected,setSelected]=useState(''),[provider,setProvider]=useState('Viator'),selectId=useId();
 const options=matches.filter(m=>m.category==='Experiences'||m.category==='Transport');
 const match=options.find(m=>m.id===selected)||options[0];
 if(!match)return null;
 const dates=trip.dates[trip.activeDate]||trip.dates[0];
 // A changed recommendation, date window or party starts a fresh, unsubmitted search.
 const context=JSON.stringify([match.source,match.id,match.query,match.place,match.title,match.quote,dates,trip.currency,trip.adults]);
 return <section className="availability-panel" aria-label="Activity provider options">
  <h3>Compare activity options</h3>
  <p>Choose something from your reel, then explore options from Viator or GetYourGuide. Check the operator and itinerary before booking.</p>
  <div className="reel-import">
   <label htmlFor={selectId}>Activity or transport from your reel</label>
   <select id={selectId} value={match.id} onChange={e=>setSelected(e.target.value)} style={{width:'100%',maxWidth:'100%'}}>
    {options.map(m=><option key={m.id} value={m.id}>{m.title} · {m.place}</option>)}
   </select>
   <p><strong>{match.kind}</strong> · {match.place}</p>
   <details className="place-evidence"><summary>Reel context</summary><p>{match.quote}</p>{match.note&&<p>{match.note}</p>}</details>
  </div>
  <div className="tabs" role="group" aria-label="Activity provider">{['Viator','GetYourGuide'].map(p=><button key={p} className={provider===p?'active':''} onClick={()=>setProvider(p)}>{p}</button>)}</div>
  {provider==='Viator'?<ViatorSearch key={context} match={match} dates={dates} currency={trip.currency} adults={trip.adults}/>:<GetYourGuideOptions key={match.id} query={match.query} date={dates.start} end={dates.end} adults={trip.adults} currency={trip.currency}/>}
 </section>;
}

export function ViatorSearch({match,dates,currency,adults}:{match:Match;dates:Window;currency:string;adults:number}){
 const [results,setResults]=useState<ViatorCatalogResults|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [place,setPlace]=useState(match.place),[pending,setPending]=useState<ViatorDestinationRequired|null>(null),[destinationId,setDestinationId]=useState('');
 const [terms,setTerms]=useState(match.query),[locationNotice,setLocationNotice]=useState('');
 const placeId=useId(),destinationSelectId=useId();
 const controller=useRef<AbortController|null>(null),requestId=useRef(0);
 useEffect(()=>()=>{requestId.current++;controller.current?.abort();},[]);
 let invalid='';
 const edited=place!==match.place||terms!==match.query;
 const searchMatch={...match,query:activitySearchQuery(terms,place),place,...(edited?{source:'explore',title:terms||place}: {})};
 try{viatorCatalogRequest(searchMatch,dates,currency,place,destinationId||undefined);}catch(e){invalid=(e as Error).message;}
 function clearSearch(){requestId.current++;controller.current?.abort();setBusy(false);setResults(null);setError('');}
 async function search(){
  if(busy)return;
  if(pending&&pending.candidates.length>0&&!destinationId)return;
  const id=++requestId.current,c=new AbortController();controller.current=c;
  setBusy(true);setError('');setResults(null);
  try{
   const request=viatorCatalogRequest(searchMatch,dates,currency,place,destinationId||undefined);
   const result=await loadViatorCatalog(request,AbortSignal.any([c.signal,AbortSignal.timeout(60000)]));
   if(id===requestId.current){
    if(result.status==='destination_required'){setPending(result);setDestinationId('');}
    else{setResults(result);setPending(null);setDestinationId('');}
   }
  }catch(e){
   if(id===requestId.current&&!c.signal.aborted)setError((e as Error).name==='TimeoutError'?'The activity search timed out. Please try again.':(e as Error).message||'The activity search failed. Please try again.');
  }finally{if(id===requestId.current)setBusy(false);}
 }
 return <>
  <div className="reel-import">
   <label htmlFor={placeId}>City or region for this activity</label>
   <input id={placeId} value={place} maxLength={200} onChange={e=>{clearSearch();const next=activityTermsAfterLocationChange(terms,place,e.target.value,!edited&&match.source!=='explore');if(terms&&next!==terms)setLocationNotice('The location changed, so the previous location-specific terms were cleared. Add an activity below; your reel evidence is unchanged.');setTerms(next);setPlace(e.target.value);setPending(null);setDestinationId('');}} style={{width:'100%'}}/>
   <label>Activity or keywords<input aria-label="Viator activity keywords" value={terms} maxLength={200} onChange={e=>{clearSearch();setTerms(e.target.value);setLocationNotice('');}} placeholder="Food tour, safari, waterfalls…"/></label>
   {locationNotice&&<p role="status">{locationNotice}</p>}
   <p>We’ll check this location with Viator before searching. Refine broad descriptions such as “the coast” to a city or region.</p>
   {pending&&<div style={{display:'block'}}>
    <p role="status">{pending.reason==='no_match'?'No matching destinations were returned. Enter a nearby city or region above.':pending.reason==='reselect'?'The destination choices changed. Please select a location again.':'Confirm the location so results stay in the right destination.'}</p>
    {pending.hasMore&&<p>More locations match this search. Choose a listed location or enter a more specific city or region.</p>}
    {pending.candidates.length>0&&<><label htmlFor={destinationSelectId}>Matching Viator destinations</label><select id={destinationSelectId} value={destinationId} onChange={e=>{clearSearch();setDestinationId(e.target.value);}} style={{width:'100%',maxWidth:'100%'}}>
     <option value="">Choose a destination</option>
     {pending.candidates.map(d=><option key={d.id} value={d.id}>{d.name}{d.parentName?' · '+d.parentName:''}</option>)}
    </select></>}
   </div>}
  </div>
  <div className="state-actions" style={{flexWrap:'wrap'}}>
   <button className="primary" disabled={!!invalid||busy||!!(pending&&pending.candidates.length&&!destinationId)} onClick={()=>void search()}>{busy?'Searching Viator…':pending&&pending.candidates.length?'Confirm destination & search':'Search Viator activities'}</button>
   <a className="provider-link" href={browseProviderUrl(searchMatch,'Viator')} target="_blank" rel="noopener noreferrer">Open Viator search ↗</a>
  </div>
  {invalid&&<p className="fine-print">{invalid}</p>}
  {!invalid&&<p className="fine-print">Search: {searchMatch.query} · {dates.start} to {dates.end} · {currency}. Public website searches require you to choose dates there.</p>}
  <p className="fine-print">Viator links may earn ReelTrip a commission.</p>
  {busy&&<p role="status" aria-live="polite">Finding catalogue matches for {searchMatch.title}…</p>}
  {error&&<p role="alert">{error}</p>}
  {results&&<div aria-live="polite">
   <p className="fine-print"><strong>{results.environment==='sandbox'?'Sandbox test results':'Viator catalogue results'}</strong> · Checked {new Date(results.checkedAt).toLocaleTimeString('en-GB')}</p>
   <p className="fine-print"><strong>Destination: {results.destination.name}{results.destination.parentName?' · '+results.destination.parentName:''}</strong></p>
   <p className="fine-print">Some tours depart from another city. Check the departure or pickup point and route; these matches do not confirm the creator’s original operator.</p>
   <p className="fine-print">{results.environment==='sandbox'?'These are test catalogue results and test prices, not live inventory. Nothing has been reserved.':`Prices are advertised starting prices, not a quote for your ${adults} ${adults===1?'adult':'adults'}. Confirm capacity, inclusions and the final price on Viator. Nothing has been reserved.`}</p>
   {results.withheldCount>0&&<p className="fine-print">{results.withheldCount} {results.withheldCount===1?'result was':'results were'} withheld because its listed destinations could not be verified within this location.</p>}
   {results.results.length===0?<p className="inline-message">No location-verified catalogue matches were found for this recommendation and date window. This does not mean the activity is sold out. A broader region may find tours departing from elsewhere, or you can check the provider website.</p>:<div className="analysis-matches">
    {results.results.map((item,i)=><article className="match-card" key={item.productCode+'-'+i}><div className="match-main">
     <span className="match-kind">{results.environment==='sandbox'?'Viator · test catalogue':'Viator · catalogue match'}</span>
     <h3>{item.title}</h3><span className="availability-unknown">Party availability: check on Viator</span>
     <p className="match-note">{item.price?`${results.environment==='sandbox'?'Test price from':'From'} ${new Intl.NumberFormat('en-GB',{style:'currency',currency:item.price.currency,currencyDisplay:'code'}).format(item.price.amount)}`:'See price on Viator'}</p>
     <a className="provider-link" href={item.productUrl} target="_blank" rel="noopener noreferrer">View on Viator ↗</a>
     {results.environment!=='sandbox'&&<InterestedButton item={{kind:'activity',title:item.title,place:results.destination.name,provider:'Viator',url:item.productUrl,...(searchMatch.source!=='explore'?{sourceId:searchMatch.source}:{})}}/>}
    </div></article>)}
   </div>}
  </div>}
 </>;
}
