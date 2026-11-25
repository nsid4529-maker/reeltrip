'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,MapPin,Search,Wrench} from 'lucide-react';
import {checkedLabel,fixShared,forgetPlace,personalFixes,placeInputKey,resolvePlace,savePersonalFix,searchVenues,timestamp,venue,withPersonalFix,type Candidate,type PlaceInput,type PlaceView,type Venue} from '@/lib/places-client';
import {track} from '@/lib/track';
import {firstPlaceView} from '@/lib/place-views';
import {HandoffLinks} from '@/components/bucket-map';
import {placeLinks,type PlaceForLinks,type Trip} from '@/lib/handoff';

const TAG:Record<string,string>={high:'Matched · high confidence',medium:'Matched · medium confidence',confirmed:'Confirmed venue'};
function tagFor(view:PlaceView){
 if(view.status==='matched')return TAG[view.confidence]||'Matched';
 if(view.status==='possible')return 'Possible match — confirm?';
 if(view.status==='not_a_venue')return 'No venue named in the reel';
 if(view.status==='not_a_place')return 'Marked not a real place';
 if(view.status==='unmatched')return 'No matching venue found';
 return 'Not matched yet';
}

function Attribution({provider,mapsUri}:{provider:Venue['provider'];mapsUri:string}){
 if(provider==='fixture')return <span className="place-attribution">Sample data · not a real listing</span>;
 return mapsUri?<a className="place-attribution" href={mapsUri} target="_blank" rel="noopener noreferrer">Google Maps<ArrowUpRight size={12} aria-hidden="true"/></a>:<span className="place-attribution">Google Maps</span>;
}

export function PlaceMatch({place,bucketId,source,trip}:{place:PlaceInput;bucketId?:string;source?:{url:string;creator?:string;second?:number;platform?:string};trip?:Trip}){
 const [view,setView]=useState<PlaceView|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[details,setDetails]=useState<Venue|null>(null),[detailsError,setDetailsError]=useState('');
 const [fixing,setFixing]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState<Candidate[]|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const lookup=useRef(0),inputKey=placeInputKey(place);
 const load=useCallback(()=>{const request=++lookup.current;resolvePlace(place,bucketId).then(v=>{if(request!==lookup.current)return;setView(bucketId?v:withPersonalFix(v,personalFixes(localStorage)[place.key]));setError('');}).catch(e=>{if(request===lookup.current)setError((e as Error).message);});},[inputKey,bucketId]);
 useEffect(()=>{setView(null);setOpen(false);setDetails(null);load();return ()=>{lookup.current++;};},[load]);
 function openVenue(){setOpen(true);if(firstPlaceView(window,place.key,bucketId))track('place_viewed',{placeId:place.key},bucketId);}
 // Name, address and the Maps link are fetched only when the place is opened.
 useEffect(()=>{if(!open||!view?.placeId){setDetails(null);return;}let live=true;setDetailsError('');venue(view.placeId).then(v=>{if(live)setDetails(v);}).catch(e=>{if(live)setDetailsError((e as Error).message);});return ()=>{live=false;};},[open,view?.placeId]);
 async function apply(change:{placeId?:string;notAPlace?:boolean;reset?:boolean},provider?:'google'|'fixture'){
  setBusy(true);setNotice('');
  try{
   if(bucketId){await fixShared(bucketId,place.key,change);forgetPlace(place.key,bucketId);}
   else savePersonalFix(localStorage,place.key,change.reset?null:{placeId:change.placeId??null,provider:provider??view?.provider??null,notAPlace:!!change.notAPlace,fixedAt:Date.now()});
   window.dispatchEvent(new CustomEvent('reeltrip:place-updated',{detail:{key:place.key,bucketId}}));
   setFixing(false);setResults(null);setNotice(change.reset?'Fix undone.':bucketId?'Fixed for everyone in this bucket.':'Fixed on this device.');load();
  }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
 }
 async function search(event:FormEvent){event.preventDefault();setBusy(true);setNotice('');try{setResults(await searchVenues(query));}catch(e){setNotice((e as Error).message);setResults(null);}finally{setBusy(false);}}
 function startFix(){setFixing(true);openVenue();setQuery([place.title.replace(/^.+?\s+at\s+(?=\p{Lu})/u,''),place.place].filter(Boolean).join(' ').slice(0,120));setResults(null);}
 if(error)return <div className="place-match"><p className="place-tag is-muted">Not matched yet</p></div>;
 if(!view)return <div className="place-match"><p className="place-tag is-muted" role="status">Checking the venue…</p></div>;
 const hasVenue=!!view.placeId&&!!view.provider&&(view.status==='matched'||view.status==='possible');
 const checked=checkedLabel(hasVenue?view.checkedAt:null),canFix=view.status!=='not_a_venue';
 return <div className={'place-match is-'+view.status}>
  <div className="place-match-top">
   <span className={'place-tag is-'+(view.status==='matched'?view.confidence:view.status)}>{tagFor(view)}</span>
   {checked&&<span className="place-checked">Last checked <time dateTime={new Date(view.checkedAt!).toISOString()} title={checked.exact} tabIndex={0} aria-label={'Last checked '+checked.exact}>{checked.relative}</time></span>}
  </div>
  {view.fixedBy&&<p className="place-fixed-by">Fixed by {view.fixedBy.name}</p>}
  {source&&<p className="place-source">From <a href={source.url} target="_blank" rel="noopener noreferrer">{source.creator?'@'+source.creator.replace(/^@/,''):'the reel'}{source.second!==undefined&&<> at {timestamp(source.second)}</>}<ArrowUpRight size={12} aria-hidden="true"/></a></p>}
  <div className="place-actions">
   {hasVenue&&<button type="button" className="secondary" aria-expanded={open} onClick={open?()=>setOpen(false):openVenue}><MapPin size={14} aria-hidden="true"/>{open?'Hide venue':view.status==='possible'?'See the possible venue':'Show venue'}</button>}
   {canFix&&<button type="button" className="text-button" onClick={fixing?()=>setFixing(false):startFix}><Wrench size={14} aria-hidden="true"/>{fixing?'Cancel':'Fix it'}</button>}
   {view.fixed&&!fixing&&<button type="button" className="text-button" disabled={busy} onClick={()=>apply({reset:true})}>Undo fix</button>}
  </div>
  {open&&hasVenue&&<div className="place-venue">{details?<><strong>{details.name}</strong><span>{details.address}</span><Attribution provider={details.provider} mapsUri={details.mapsUri}/>
   {view.status==='possible'&&<button type="button" className="primary" disabled={busy} onClick={()=>apply({placeId:details.id},details.provider)}><Check size={14} aria-hidden="true"/>Yes, that’s the place</button>}</>
   :detailsError?<span role="alert">{detailsError}</span>:<span role="status">Loading the venue…</span>}</div>}
  {fixing&&<div className="place-fix">
   <form onSubmit={search}><label className="shared-field" htmlFor={'fix-'+place.key}>Search for the right venue<input id={'fix-'+place.key} value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary" disabled={busy||query.trim().length<2}><Search size={14} aria-hidden="true"/>Search</button></form>
   {results&&(results.length?<ul className="place-results">{results.map(c=><li key={c.id}><button type="button" disabled={busy} onClick={()=>apply({placeId:c.id},c.id.startsWith('fixture_')?'fixture':'google')}><strong>{c.name}</strong><span>{c.address}</span></button></li>)}</ul>:<p className="fine-print">No venues found. Try another name or area.</p>)}
   <button type="button" className="text-button" disabled={busy} onClick={()=>apply({notAPlace:true})}>Not a real place</button>
   <p className="fine-print">{bucketId?'Your fix applies for everyone in this bucket, with your name on it.':'Your fix is saved on this device.'}</p>
  </div>}
  {trip&&view.status==='matched'&&<HandoffLinks links={placeLinks(place as PlaceForLinks,trip)} bucketId={bucketId}/>}
  {notice&&<p className="place-notice" role="status">{notice}</p>}
 </div>;
}
