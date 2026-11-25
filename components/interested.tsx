'use client';
import {useEffect,useId,useState} from 'react';
import {Check} from 'lucide-react';
import {INTERESTS_KEY,INTERESTS_CHANGED,changeInterest,editInterest,interestKey,itemForProviderLink,loadInterests,type Interest,type InterestInput} from '@/lib/interested';
import {useTrips} from '@/components/trip-buckets';
import {loadTrips} from '@/lib/trip-buckets';
const changed=INTERESTS_CHANGED;
const storageError='Could not save your Interested list on this device. Check browser storage and try again.';

export function useInterests(){
 const [items,setItems]=useState<Interest[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  function refresh(){try{setItems(loadInterests(window.localStorage));setError('');}catch{setError('Your Interested list could not be read on this device. Existing data has been kept.');}finally{setReady(true);}}
  function onStorage(e:StorageEvent){if(e.key===INTERESTS_KEY||e.key===null)refresh();}
  refresh();window.addEventListener(changed,refresh);window.addEventListener('storage',onStorage);
  return ()=>{window.removeEventListener(changed,refresh);window.removeEventListener('storage',onStorage);};
 },[]);
 function mutate(run:()=>Interest[]){
  try{setItems(run());setError('');window.dispatchEvent(new Event(changed));return true;}
  catch(e){setError(e instanceof Error&&(/200 places|kept unchanged|cannot be saved|too large|no longer|Check the saved|Remove this choice/.test(e.message))?e.message:storageError);return false;}
 }
 function update(item:InterestInput,action:'toggle'|'remove'|'add'){return mutate(()=>{
  const id=interestKey(item),removing=action==='remove'||(action==='toggle'&&loadInterests(window.localStorage).some(row=>row.id===id));
  // Recheck storage at click time as another tab can assign this choice after
  // the list rendered. Deleting a global record must not strand trip members.
  if(removing&&loadTrips(window.localStorage).trips.some(trip=>trip.interestIds.includes(id)))throw new Error('Remove this choice from its trips before deleting it from All saved.');
  return changeInterest(window.localStorage,item,action);
 });}
 return {items,ready,error,add:(item:InterestInput)=>update(item,'add'),remove:(item:InterestInput)=>update(item,'remove'),toggle:(item:InterestInput)=>update(item,'toggle'),edit:(id:string,details:{title:string;place:string;notes:string})=>mutate(()=>editInterest(window.localStorage,id,details)),contains:(item:InterestInput)=>{try{const id=interestKey(item);return items.some(row=>row.id===id);}catch{return false;}}};
}

// Saving from a recommendation is deliberately idempotent. Removing a choice
// from one trip belongs to the trip controls and never deletes the global save.
export function InterestedButton({item,tripId}:{item:InterestInput;tripId?:string}){
 const interests=useInterests(),trips=useTrips(),[message,setMessage]=useState('');
 const trip=tripId===undefined?trips.activeTrip:trips.trips.find(row=>row.id===tripId),invalidTrip=tripId!==undefined&&!trip;
 let id='';try{id=interestKey(item);}catch{/* Invalid recommendations cannot be saved. */}
 const saved=interests.contains(item)&&(!trip||trip.interestIds.includes(id));
 const target=trip?trip.name:'All saved';
 return <div className="interested-control"><button type="button" className={'secondary interested-button'+(saved?' is-interested':'')} disabled={!interests.ready||!trips.ready||invalidTrip||!id||!!trips.error} aria-pressed={saved} aria-label={(saved?'Saved ':'Save ')+item.title+' to '+target} onClick={()=>{
  setMessage('');
  if(!interests.add(item))return;
  if(trip&&!trips.assignInterest(id,true,trip.id)){setMessage('Saved in All saved, but could not add it to '+trip.name+'. Try again.');return;}
  setMessage('Saved to '+target+'.');
 }}>{saved&&<Check size={15}/>} {saved?'Interested':'+ Interested'} · {target}</button>
 {!trip&&trips.ready&&!invalidTrip&&<p className="fine-print interest-destination">Saving to All saved. <a href="/trips">Choose or create a trip</a> to group your choices.</p>}
 {invalidTrip&&<p className="interest-error" role="alert">This trip is no longer available. Choose a trip before saving.</p>}
 {message&&<p className="fine-print" role="status">{message}</p>}
 {(interests.error||trips.error)&&<p className="interest-error" role="alert">{interests.error||trips.error}</p>}</div>;
}

export function InterestTripAssignments({item,trips}:{item:Interest;trips:ReturnType<typeof useTrips>}){
 const [selected,setSelected]=useState<string|null>(null),[message,setMessage]=useState('');
 const memberships=trips.trips.filter(trip=>trip.interestIds.includes(item.id));
 const choice=selected===null?trips.activeId||'':trips.trips.some(trip=>trip.id===selected)?selected:'';
 return <div className="interest-trip-assignments">
  {memberships.length>0?<div className="interest-trip-tags" aria-label={'Trips containing '+item.title}>{memberships.map(trip=><span key={trip.id}>{trip.name}<button type="button" className="text-button" aria-label={'Remove '+item.title+' from '+trip.name} onClick={()=>{setMessage('');if(trips.assignInterest(item.id,false,trip.id))setMessage('Removed from '+trip.name+'. Your saved choice is kept.');}}>Remove from trip</button></span>)}</div>:<p className="fine-print">Not assigned to a trip yet.</p>}
  <div className="interest-assignment-fields"><label>Add to a trip<select value={choice} disabled={!trips.ready||!!trips.error} onChange={event=>{setSelected(event.target.value);setMessage('');}}><option value="">Choose a trip</option>{trips.trips.map(trip=><option value={trip.id} key={trip.id}>{trip.name}</option>)}</select></label><button className="secondary" type="button" disabled={!trips.ready||!choice||!!trips.error||memberships.some(trip=>trip.id===choice)} onClick={()=>{setMessage('');const trip=trips.trips.find(row=>row.id===choice);if(trip&&trips.assignInterest(item.id,true,trip.id))setMessage('Added to '+trip.name+'.');}}>Add to trip</button></div>
  {!trips.trips.length&&trips.ready&&<a className="provider-link" href="/trips">Create your first trip</a>}
  {message&&<p role="status" className="fine-print">{message}</p>}{trips.error&&<p role="alert" className="interest-error">{trips.error}</p>}
 </div>;
}

export function InterestEditor({item,onSave}:{item:Interest;onSave:(details:{title:string;place:string;notes:string})=>boolean}){
 const [editing,setEditing]=useState(false),[title,setTitle]=useState(item.title),[place,setPlace]=useState(item.place),[notes,setNotes]=useState(item.notes||'');const id=useId();
 if(!editing)return <button className="text-button" type="button" onClick={()=>{setTitle(item.title);setPlace(item.place);setNotes(item.notes||'');setEditing(true);}}>Edit name, location &amp; notes</button>;
 return <form className="interest-edit-form" onSubmit={event=>{event.preventDefault();if(onSave({title,place,notes}))setEditing(false);}}>
  <label htmlFor={id+'name'}>Name<input id={id+'name'} value={title} required maxLength={240} onChange={event=>setTitle(event.target.value)}/></label>
  <label htmlFor={id+'place'}>Location<input id={id+'place'} value={place} maxLength={240} onChange={event=>setPlace(event.target.value)} placeholder="City or neighbourhood"/></label>
  <label htmlFor={id+'notes'}>What interests you?<textarea id={id+'notes'} value={notes} maxLength={600} onChange={event=>setNotes(event.target.value)} placeholder="For example: sunset cruise, vegetarian options, a quiet table"/></label>
  <p className="fine-print">Your notes help plan trips that include this choice. They do not confirm the provider’s facilities or availability.</p>
  <div className="state-actions"><button className="secondary" type="submit">Save changes</button><button className="text-button" type="button" onClick={()=>setEditing(false)}>Cancel</button></div>
 </form>;
}

export function ProviderLinkSaveForm(){
 const interests=useInterests(),trips=useTrips(),[url,setUrl]=useState(''),[title,setTitle]=useState(''),[place,setPlace]=useState(''),[destination,setDestination]=useState('active'),[message,setMessage]=useState(''),[invalid,setInvalid]=useState(false);
 const proposed=itemForProviderLink(url),targetId=destination==='active'?trips.activeId:destination==='all'?null:destination;
 return <form id="save-link" className="provider-save-form" onSubmit={event=>{
  event.preventDefault();setMessage('');setInvalid(false);
  const parsed=itemForProviderLink(url,title),trip=targetId?trips.trips.find(row=>row.id===targetId):null;
  if(!parsed){setInvalid(true);setMessage('Use a full link for one activity, hotel or restaurant, or a ReelTrip Skyscanner flight search. Search pages and shortened place links cannot be saved here.');return;}
  if(targetId&&!trip){setInvalid(true);setMessage('That trip is no longer available. Choose another trip or All saved.');return;}
  const item={...parsed,place:place.trim()},alreadySaved=interests.contains(item);
  if(!interests.add(item))return;
  if(trip&&!trips.assignInterest(interestKey(item),true,trip.id)){setInvalid(true);setMessage('Saved in All saved, but could not add it to '+trip.name+'. Try again.');return;}
  setMessage((alreadySaved?'Saved choice kept':'Saved '+item.title)+' in '+(trip?trip.name:'All saved')+'.');setUrl('');setTitle('');setPlace('');
 }}>
  <h2>Save a place from its link</h2>
  <p>Copy a specific activity, hotel or restaurant page here. In the updated iPhone app, Share → ReelTrip → Save to Interested also saves a choice; assign it to a trip below.</p>
  <div className="provider-save-fields"><label htmlFor="provider-place-url">Provider page link<input id="provider-place-url" type="url" required maxLength={2048} value={url} onChange={event=>{setUrl(event.target.value);setInvalid(false);setMessage('');}} placeholder="https://www.getyourguide.com/…" aria-invalid={invalid||undefined} aria-describedby="provider-save-help provider-save-feedback"/></label><label htmlFor="provider-place-name">Name (optional)<input id="provider-place-name" type="text" maxLength={240} value={title} onChange={event=>setTitle(event.target.value)} placeholder={proposed?.title||'A name you’ll recognise'}/></label><label htmlFor="provider-place-location">Location (optional)<input id="provider-place-location" maxLength={240} value={place} onChange={event=>setPlace(event.target.value)} placeholder="City or neighbourhood"/></label><label htmlFor="provider-save-trip">Save to<select id="provider-save-trip" value={destination} onChange={event=>setDestination(event.target.value)}><option value="active">{trips.activeTrip?'Current trip: '+trips.activeTrip.name:'All saved — no trip selected'}</option><option value="all">All saved (no trip)</option>{trips.trips.map(trip=><option key={trip.id} value={trip.id}>{trip.name}</option>)}</select></label><button className="primary" type="submit" disabled={!interests.ready||!trips.ready||!!trips.error}>Save choice</button></div>
  {proposed&&!title.trim()&&<p className="fine-print">Suggested name from the link: <strong>{proposed.title}</strong>. You can change it; the provider page has not been checked.</p>}
  <p id="provider-save-help" className="fine-print">Supports Viator, GetYourGuide, Booking.com, Expedia, Airbnb room links, OpenTable, SevenRooms and ReelTrip’s Skyscanner searches. Saves on this device; favourites in provider accounts do not sync automatically. Availability is checked with the provider.</p>
  <div id="provider-save-feedback" className="provider-save-feedback" aria-live="polite">{message&&<p role={invalid?'alert':'status'}>{message}</p>}{(interests.error||trips.error)&&<p role="alert">{interests.error||trips.error}</p>}</div>
 </form>;
}
