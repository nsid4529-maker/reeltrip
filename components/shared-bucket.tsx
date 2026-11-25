'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Check,Circle,Copy,ExternalLink,Link2,Plus,Share2,ThumbsDown,ThumbsUp,Trash2,Users} from 'lucide-react';
import {addSharedReel,becomeMember,deleteShared,createInvite,createShared,getShared,inviteLink,joinShared,listShared,me,previewInvite,setSharedTrip,setShortlistAgreed,rememberShared,removeSharedReel,revokeInvite,sharedFor,tokenFromHash,voteShared,SharedError,type InvitePreview,type SharedBucket,type SharedPlace,type SharedSummary} from '@/lib/shared-client';
import {track} from '@/lib/track';
import {hasNativeBridge} from '@/lib/native-library';
import {PlaceMatch} from '@/components/place-match';
import {BucketMap,StayHandoff} from '@/components/bucket-map';
import {tripDates} from '@/lib/handoff';
import {SharedTripPlan} from '@/components/shared-plan';
import {sharedPlaceAnchor} from '@/lib/shared-plan';

const POLL_MS=15000,ACTIVE_POLL_MS=5000;
const message=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';

// Completed analyses should reach the map promptly; idle buckets keep the slower cadence.
function useLiveRefresh(load:()=>void,bucket:SharedBucket|null){
 useEffect(()=>{
  load();
  const visible=()=>{if(document.visibilityState==='visible')load();};
  window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
  return ()=>{window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
 },[load]);
 // Restart after each response so network time cannot make the next poll miss the server's cooldown.
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},bucket?.reels.some(r=>r.status==='analysing')?ACTIVE_POLL_MS:POLL_MS);return()=>clearInterval(timer);},[load,bucket]);
}

// "What should your group call you?" Shown only when this device has no member yet.
export function NameField({value,onChange,id='shared-name'}:{value:string;onChange:(value:string)=>void;id?:string}){
 return <label className="shared-field" htmlFor={id}>Your name, as your group will see it<input id={id} required maxLength={40} autoComplete="given-name" value={value} onChange={e=>onChange(e.target.value)} placeholder="e.g. Aisha"/></label>;
}

// What an invite link does, said once wherever a link is shown.
export const INVITE_EXPLAINER='Anyone with this link can join from their own phone or laptop: they type a name, no app, account or password. It works for 14 days and for up to 6 people. You can turn it off under Active invite links.';
function CopyLink({url}:{url:string}){
 const [copied,setCopied]=useState(false),[canShare,setCanShare]=useState(false);
 useEffect(()=>{setCanShare(typeof navigator!=='undefined'&&typeof navigator.share==='function');},[]);
 return <><div className="shared-invite-link"><input readOnly value={url} aria-label="Invite link" onFocus={e=>e.target.select()}/><button type="button" className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{/* The link stays selectable for manual copy. */}}}>{copied?<Check size={15} aria-hidden="true"/>:<Copy size={15} aria-hidden="true"/>}{copied?'Copied':'Copy link'}</button>{canShare&&<button type="button" className="secondary" onClick={()=>navigator.share({title:'Join our ReelTrip bucket',url}).catch(()=>{/* Closing the share sheet is fine. */})}><Share2 size={15} aria-hidden="true"/>Share</button>}<span className="sr-only" role="status">{copied?'Invite link copied':''}</span></div>
 <p className="fine-print shared-invite-explainer">{INVITE_EXPLAINER}</p></>;
}

// On a personal bucket: turn it into a shared bucket and show an invite link.
export function ShareThisBucket({tripId,name,reelUrls}:{tripId:string;name:string;reelUrls:string[]}){
 const [member,setMember]=useState<{name:string}|null|undefined>(undefined),[yourName,setYourName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[shared,setShared]=useState<string|null>(null),[link,setLink]=useState('');
 const [creationUncertain,setCreationUncertain]=useState(false);
 useEffect(()=>{setShared(sharedFor(localStorage,tripId));setLink('');setError('');setCreationUncertain(false);},[tripId]);
 useEffect(()=>{me().then(setMember).catch(()=>setMember(null));},[]);
 async function share(event:FormEvent){
  event.preventDefault();if(busy||creationUncertain)return;setBusy(true);setError('');
  try{
   if(!member)setMember(await becomeMember(yourName));
   const created=await createShared(name,reelUrls);rememberShared(localStorage,tripId,created.id);setShared(created.id);
   const invite=await createInvite(created.id);setLink(inviteLink(location.origin,invite.token));
  }catch(e){setError(message(e));setCreationUncertain(e instanceof SharedError&&e.bucketMayExist);}finally{setBusy(false);}
 }
 async function newLink(){if(!shared||busy)return;setBusy(true);setError('');try{setLink(inviteLink(location.origin,(await createInvite(shared)).token));}catch(e){setError(message(e));}finally{setBusy(false);}}
 return <section className="shared-share" aria-labelledby="share-bucket-heading">
  <div className="shared-share-heading"><Users size={22} aria-hidden="true"/><div><h2 id="share-bucket-heading">Plan this trip together</h2><p>Share this bucket with 2–6 people. Everyone adds reels from their own phone and votes on the places.</p></div></div>
  {shared?<>
   {link?<><p className="shared-step">Send this link to your group.</p><CopyLink url={link}/></>:<button type="button" className="secondary" disabled={busy} onClick={newLink}><Link2 size={15} aria-hidden="true"/>Make an invite link</button>}
   <a className="primary shared-open" href={'/shared?id='+shared}>Open shared bucket<ExternalLink size={15} aria-hidden="true"/></a>
  </>:<form onSubmit={share}>
   {member===null&&<NameField value={yourName} onChange={setYourName}/>}
   <button className="primary" type="submit" disabled={busy||creationUncertain||member===undefined}>{busy?'Sharing…':'Share this bucket'}</button>
   <p className="fine-print">Its Instagram and TikTok reels are copied into the shared bucket. Uploaded videos stay private to this browser. Your personal bucket is unchanged.</p>
  </form>}
  {error&&<p className="upload-error" role="alert">{error}</p>}
  {creationUncertain&&<a className="secondary" href="/shared">Check your shared buckets</a>}
 </section>;
}

function Vote({bucketId,place,onChanged}:{bucketId:string;place:SharedPlace;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function vote(value:1|-1){setBusy(true);setError('');try{const next=place.myVote===value?0:value;await voteShared(bucketId,place.id,next);if(next!==0)track('vote_cast',{placeId:place.id,vote:next===1?'up':'down'},bucketId);onChanged();}catch(e){setError(message(e));}finally{setBusy(false);}}
 return <div className="shared-vote" role="group" aria-label={'Your vote on '+place.title}>
  <button type="button" aria-pressed={place.myVote===1} aria-label={'Keep, '+place.up+(place.up===1?' vote':' votes')} disabled={busy} onClick={()=>vote(1)}><ThumbsUp size={16} aria-hidden="true"/><span aria-hidden="true">Keep · {place.up}</span></button>
  <button type="button" aria-pressed={place.myVote===-1} aria-label={'Skip, '+place.down+(place.down===1?' vote':' votes')} disabled={busy} onClick={()=>vote(-1)}><ThumbsDown size={16} aria-hidden="true"/><span aria-hidden="true">Skip · {place.down}</span></button>
  {error&&<p className="shared-inline-error" role="alert">{error}</p>}
 </div>;
}

// The owner sets dates and travellers; everyone else sees them. They fill the booking links.
function TripDetails({bucket,onSaved}:{bucket:SharedBucket;onSaved:()=>void}){
 const owner=bucket.me.role==='owner',[start,setStart]=useState(bucket.trip.start||''),[end,setEnd]=useState(bucket.trip.end||''),[travellers,setTravellers]=useState(String(bucket.trip.travellers)),[busy,setBusy]=useState(false),[note,setNote]=useState('');
 useEffect(()=>{setStart(bucket.trip.start||'');setEnd(bucket.trip.end||'');setTravellers(String(bucket.trip.travellers));},[bucket.trip.start,bucket.trip.end,bucket.trip.travellers]);
 async function save(event:FormEvent){event.preventDefault();setBusy(true);setNote('');try{await setSharedTrip(bucket.id,{start,end,travellers:Number(travellers)});setNote('Trip details saved for everyone.');onSaved();}catch(e){setNote(message(e));}finally{setBusy(false);}}
 const summary=(bucket.trip.start&&bucket.trip.end?tripDates(bucket.trip.start,bucket.trip.end):'Dates not set yet')+' · '+bucket.trip.travellers+(bucket.trip.travellers===1?' traveller':' travellers')+(bucket.trip.travellersSet?'':' (one per member until the owner sets it)');
 return <section className="shared-trip" aria-labelledby="shared-trip-heading"><h2 id="shared-trip-heading">Trip dates and travellers</h2>
  {owner?<form onSubmit={save} className="shared-trip-form">
   <label className="shared-field" htmlFor="trip-start">Check-in<input id="trip-start" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label className="shared-field" htmlFor="trip-end">Check-out<input id="trip-end" type="date" value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)}/></label>
   <label className="shared-field" htmlFor="trip-travellers">Travellers<select id="trip-travellers" value={travellers} onChange={e=>setTravellers(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
   <button className="secondary" disabled={busy}>{busy?'Saving…':'Save trip details'}</button>
  </form>:<p>{summary}</p>}
  {owner&&<p className="fine-print">{summary}. These fill the booking links below; you can change them any time.</p>}
  {note&&<p className="place-notice" role="status">{note}</p>}
 </section>;
}

// "We've agreed our shortlist": any member records it, with their name and the date.
function Shortlist({bucket,onChanged}:{bucket:SharedBucket;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState('');
 async function change(agreed:boolean){
  setBusy(true);setNote('');
  try{await setShortlistAgreed(bucket.id,agreed);
   if(agreed)track('plan_finished',{placeCount:bucket.reels.reduce((n,r)=>n+r.places.filter(p=>p.up>0).length,0)},bucket.id);
   onChanged();}catch(e){setNote(message(e));}finally{setBusy(false);}
 }
 const when=bucket.shortlist?new Date(bucket.shortlist.at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'';
 return <section className="shared-shortlist" aria-labelledby="shared-shortlist-heading"><h2 id="shared-shortlist-heading">Your shortlist</h2>
  {bucket.shortlist?<><p className="shortlist-agreed" role="status"><Check size={16} aria-hidden="true"/>Shortlist agreed by {bucket.shortlist.by.id===bucket.me.id?'you':bucket.shortlist.by.name}, {when}</p><button type="button" className="text-button" disabled={busy} onClick={()=>change(false)}>Undo — we’re still deciding</button></>
  :<><p>When your group has voted and agreed the places you want, mark it here.</p><button type="button" className="primary" disabled={busy} onClick={()=>change(true)}><Check size={16} aria-hidden="true"/>We’ve agreed our shortlist</button></>}
  {note&&<p className="shared-inline-error" role="alert">{note}</p>}
 </section>;
}

// First-run guide: the six steps from an empty bucket to a booking link,
// each ticked from the bucket itself, so it is right on every member's phone.
export type Step={id:string;title:string;text:string;href:string;done:boolean};
export function onboardingSteps(bucket:SharedBucket):Step[]{
 const owner=bucket.me.role==='owner',places=bucket.reels.flatMap(r=>r.places),ownerName=bucket.members.find(m=>m.role==='owner')?.name||'the owner';
 return [
  {id:'invite',title:'Invite your group',text:owner?'Make an invite link and send it to your group chat. Each person opens it on their phone and types a name.':'Anyone else coming? Make an invite link and send it to them.',href:'#shared-members-heading',done:bucket.members.length>=2},
  {id:'reels',title:'Add the reels you’ve saved',text:'In Instagram or TikTok tap Share → Copy link, then paste it under Add a reel. ReelTrip finds the places it mentions, usually within a few minutes.',href:'#shared-add-heading',done:bucket.reels.length>0},
  {id:'vote',title:'Vote keep or skip',text:'Tap Keep on the places you’d go to and Skip on the ones you wouldn’t. Everyone sees the totals.',href:'#shared-reels-heading',done:places.some(p=>p.myVote!==0)},
  {id:'trip',title:'Set the dates and travellers',text:owner?'Add check-in, check-out and how many are travelling. They fill the booking links.':`${ownerName} sets the dates and travellers. They fill the booking links.`,href:'#shared-trip-heading',done:!!bucket.trip.start},
  {id:'shortlist',title:'Agree your shortlist',text:'When you’ve all voted, anyone can mark the shortlist as agreed.',href:'#shared-shortlist-heading',done:!!bucket.shortlist},
  {id:'book',title:'Open a booking link',text:'Use Find a place to stay, or Book/Reserve on a matched place. ReelTrip shows no prices and books nothing; you finish on the partner’s site.',href:'#stay-handoff-heading',done:false},
 ];
}
const GUIDE_HIDDEN_KEY='reeltrip-guide-hidden-v1';
function GettingStarted({bucket}:{bucket:SharedBucket}){
 const [hidden,setHidden]=useState(true);
 useEffect(()=>{try{setHidden(JSON.parse(localStorage.getItem(GUIDE_HIDDEN_KEY)||'[]').includes(bucket.id));}catch{setHidden(false);}},[bucket.id]);
 function hide(){setHidden(true);try{const ids=JSON.parse(localStorage.getItem(GUIDE_HIDDEN_KEY)||'[]');localStorage.setItem(GUIDE_HIDDEN_KEY,JSON.stringify([...ids,bucket.id].slice(-100)));}catch{/* Hidden for this visit only. */}}
 function show(){setHidden(false);try{const ids=JSON.parse(localStorage.getItem(GUIDE_HIDDEN_KEY)||'[]');localStorage.setItem(GUIDE_HIDDEN_KEY,JSON.stringify(ids.filter((id:string)=>id!==bucket.id)));}catch{/* Shown for this visit only. */}}
 const steps=onboardingSteps(bucket),next=steps.find(s=>!s.done)?.id;
 if(hidden)return <section className="shared-guide" id="shared-guide-heading"><button type="button" className="text-button" onClick={show}>Show these tips</button></section>;
 return <section className="shared-guide" aria-labelledby="shared-guide-heading">
  <div className="shared-guide-head"><h2 id="shared-guide-heading">How this works</h2><button type="button" className="text-button" onClick={hide}>Hide these tips</button></div>
  <ol>{steps.map(s=><li key={s.id} className={s.done?'is-done':s.id===next?'is-next':''}>
   {s.done?<Check size={18} aria-hidden="true"/>:<Circle size={18} aria-hidden="true"/>}
   <div><a href={s.href}><strong>{s.title}</strong></a>{s.done?<span className="sr-only"> (done)</span>:s.id===next&&<span className="sr-only"> (next step)</span>}{!s.done&&<p>{s.text}</p>}</div>
  </li>)}</ol>
  <p className="fine-print">Everyone in the bucket sees the same reels, votes and dates; changes show up within about 15 seconds. <a href="/privacy">What ReelTrip stores</a></p>
 </section>;
}

// Errors opening a bucket, with what to do next.
export function bucketError(error:unknown):{title:string;text:string}{
 const status=error instanceof SharedError?error.status:-1;
 if(status===401)return {title:'Join this bucket on this device first',text:'ReelTrip remembers you per phone or browser, not by account. Open the invite link you were sent on this device to join. Already joined somewhere else? Open the bucket there.'};
 if(status===404)return {title:'We couldn’t find this bucket',text:'It may have been deleted, or you joined it on another phone or browser. Open the invite link again on this device, or ask whoever invited you for a new link.'};
 if(status===0)return {title:'You seem to be offline',text:'Check your connection; the bucket will load when you’re back online.'};
 return {title:'We couldn’t open this bucket',text:message(error)+' Reload the page to try again.'};
}

// Owner only: delete the bucket and everything linked to it, for everyone.
function DeleteBucket({bucket}:{bucket:SharedBucket}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 if(bucket.me.role!=='owner')return <p className="fine-print shared-delete-note">Only {bucket.members.find(m=>m.role==='owner')?.name||'the owner'} can delete this bucket. <a href="/privacy">How deletion works</a></p>;
 async function remove(){
  if(!confirm(`Delete “${bucket.name}” for everyone? Its reels, votes, place fixes, invite links and members’ names go too. This can’t be undone.`))return;
  setBusy(true);setError('');
  try{await deleteShared(bucket.id);location.assign('/shared?deleted=1');}catch(e){setError(message(e));setBusy(false);}
 }
 return <section className="shared-delete" aria-labelledby="shared-delete-heading"><h2 id="shared-delete-heading">Delete this bucket</h2>
  <p>Removes the bucket for everyone: its reels, votes, place fixes, invite links and trip details, plus the name of anyone who isn’t in another bucket. It can’t be undone.</p>
  <button type="button" className="secondary danger" disabled={busy} onClick={remove}><Trash2 size={15} aria-hidden="true"/>{busy?'Deleting…':'Delete this bucket'}</button>
  {error&&<p className="shared-inline-error" role="alert">{error}</p>}
 </section>;
}

const STATUS:Record<string,string>={analysing:'Finding places… this usually takes a few minutes. You can leave this page.',not_travel:'No travel places found',unavailable:'Not analysed yet'};

export function SharedBucketView({id}:{id:string}){
 const [bucket,setBucket]=useState<SharedBucket|null>(null),[error,setError]=useState(''),[failure,setFailure]=useState<unknown>(null),[url,setUrl]=useState(''),[adding,setAdding]=useState(false),[addError,setAddError]=useState(''),[link,setLink]=useState(''),[notice,setNotice]=useState('');
 const [category,setCategory]=useState<'all'|'Food'|'Experiences'>('all'),[revealPlace,setRevealPlace]=useState('');
 useEffect(()=>{if(revealPlace){document.getElementById(sharedPlaceAnchor(revealPlace))?.scrollIntoView({block:'start'});setRevealPlace('');}},[revealPlace]);
 const loading=useRef<{id:string;again:boolean}|null>(null),live=useRef(false),currentId=useRef(id);currentId.current=id;
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const load=useCallback((afterMutation=false)=>{
  if(loading.current?.id===id){if(afterMutation)loading.current.again=true;return;}
  const request={id,again:false};loading.current=request;
  const current=()=>live.current&&currentId.current===id&&loading.current===request;
  void(async()=>{
   do{
    request.again=false;
    try{const b=await getShared(id);if(current()){setBucket(b);setError('');setFailure(null);}}
    catch(e){if(current()){setError(message(e));setFailure(e);}}
   }while(request.again&&current());
  })().finally(()=>{if(loading.current===request)loading.current=null;});
 },[id]);
 useLiveRefresh(load,bucket);
 async function add(event:FormEvent){
  event.preventDefault();if(adding)return;setAdding(true);setAddError('');
  try{const result=await addSharedReel(id,url);if(result.added)track('reel_added',{source:'link',platform:/tiktok\.com/i.test(url)?'TikTok':'Instagram',destination:'trip',analyse:true},id);setUrl('');setNotice(result.added?'Reel added for everyone. Finding its places usually takes a few minutes.':'That reel is already in this bucket.');load(true);}
  catch(e){setAddError(message(e));}finally{setAdding(false);}
 }
 // Explicit refresh also lets old partial results use the latest analysis, without deleting the saved reel.
 const [retrying,setRetrying]=useState('');
 async function retry(reelId:string,reelUrl:string){if(retrying)return;setRetrying(reelId);setNotice('');try{await addSharedReel(id,reelUrl,true);setNotice('Checking that reel again for everyone. Saved places stay visible while it updates.');load(true);}catch(e){setNotice(message(e));}finally{setRetrying('');}}
 async function remove(reelId:string){if(!confirm('Remove this reel and its votes for everyone?'))return;try{await removeSharedReel(id,reelId);setNotice('Reel removed.');load(true);}catch(e){setNotice(message(e));}}
 async function invite(){try{setLink(inviteLink(location.origin,(await createInvite(id)).token));}catch(e){setNotice(message(e));}}
 async function revoke(inviteId:string){try{await revokeInvite(id,inviteId);setNotice('Invite link turned off.');load(true);}catch(e){setNotice(message(e));}}
 if(error&&!bucket){const e=bucketError(failure);return <div className="library-empty" role="alert"><h2>{e.title}</h2><p>{e.text}</p><a className="secondary" href="/shared">Your shared buckets</a></div>;}
 if(!bucket)return <p role="status">Loading the shared bucket…</p>;
 const places=bucket.reels.reduce((n,r)=>n+r.places.length,0),kept=bucket.reels.reduce((n,r)=>n+r.places.filter(p=>p.up>0).length,0),full=bucket.members.length>=bucket.maxMembers;
 const visiblePlace=(place:SharedPlace)=>category==='all'||place.category===category;
 const filteredCount=bucket.reels.reduce((n,r)=>n+r.places.filter(visiblePlace).length,0);
 // Pins are coloured by reel: in a shared bucket each reel is one idea.
 const mapPlaces=bucket.reels.flatMap(reel=>reel.places.map(p=>({key:p.id,title:p.title,place:p.place,query:p.query,kind:p.kind,category:p.category,group:{id:reel.id,name:reel.title||'Saved reel'},up:p.up,down:p.down,source:{url:reel.url,creator:reel.creator,second:p.second}})));
 return <article className="shared-bucket" aria-labelledby="shared-title">
  <header className="shared-dashboard-title"><div><div className="eyebrow">YOUR GROUP TRIP</div><h1 id="shared-title">{bucket.name}</h1><p className="reservation-intro">Add reels, vote on places and plan with your group.</p></div><span className="shared-role">You’re {bucket.me.role==='owner'?'the owner':'an editor'}</span></header>
  <dl className="shared-overview" aria-label="Trip overview">
   <div><dt>Saved reels</dt><dd>{bucket.reels.length}</dd></div>
   <div><dt>Places found</dt><dd>{places}</dd></div>
   <div><dt>Places with keep votes</dt><dd>{kept}</dd></div>
   <div><dt>People in your group</dt><dd>{bucket.members.length}<span> / {bucket.maxMembers}</span></dd></div>
  </dl>
  <nav className="shared-section-nav" aria-label="Trip sections"><a href="#bucket-map-heading">Map</a><a href="#shared-reels-heading">Reels & places</a><a href="#shared-plan-heading">Trip plan</a><a href="#shared-members-heading">Your group</a><a href="#shared-trip-heading">Trip details</a><a href="#shared-shortlist-heading">Shortlist</a></nav>
  {notice&&<p className="inline-message" role="status">{notice}</p>}
  {error&&<p className="inline-message" role="alert">{error} The page will keep trying.</p>}
   <section className="shared-add" aria-labelledby="shared-add-heading"><h2 id="shared-add-heading">Add a reel</h2>
    <p className="shared-capture-intro">Bring your saved finds into the plan. Everyone can explore the places and vote together.</p>
    <form onSubmit={add}><label className="shared-field" htmlFor="shared-reel-link">Instagram or TikTok link<input id="shared-reel-link" inputMode="url" autoComplete="off" required value={url} disabled={adding} aria-invalid={!!addError} aria-describedby={addError?'shared-add-error':undefined} onChange={e=>{setUrl(e.target.value);setAddError('');}} placeholder="https://www.instagram.com/reel/…"/></label><button className="primary" disabled={adding||!url.trim()}><Plus size={16} aria-hidden="true"/>{adding?'Adding…':'Add for everyone'}</button></form>
    {addError&&<p id="shared-add-error" className="upload-error" role="alert">{addError}</p>}
   </section>
  <div className="shared-dashboard-layout"><div className="shared-main-column">
  <SharedTripPlan key={bucket.id} bucket={bucket} onRevealChoice={placeId=>{setCategory('all');setRevealPlace(placeId);}}/>
  <BucketMap places={mapPlaces} bucketId={bucket.id} trip={bucket.trip}/>
  <section className="shared-reels" aria-labelledby="shared-reels-heading"><h2 id="shared-reels-heading">Reels and places</h2>
   <div className="shared-category-filter" role="group" aria-label="Filter places by type">{([['all','All'],['Food','Food'],['Experiences','Activities']] as const).map(([value,label])=>{
    const count=value==='all'?places:bucket.reels.reduce((n,r)=>n+r.places.filter(p=>p.category===value).length,0);
    return <button type="button" key={value} aria-pressed={category===value} onClick={()=>setCategory(value)}>{label}<span aria-hidden="true"> · {count}</span></button>;
   })}</div>
   <p className="fine-print" role="status">Showing {filteredCount} of {places} places. Filters don’t change your votes or trip plan.</p>
   <p className="fine-print">AI finds places from each reel, with the creator and source credited. It can make mistakes; check the reel and venue details before you book. Updates appear for everyone within about 15 seconds.</p>
   {bucket.reels.length===0?<div className="library-empty"><h3>No reels yet</h3><p>In Instagram or TikTok, tap Share → Copy link on a reel you’ve saved, then paste it above. Everyone in the bucket will see it, with the places it mentions to vote on.</p></div>:
   category!=='all'&&filteredCount===0?<p className="shared-reel-status">No {category==='Food'?'food spots':'activities'} found yet. Choose All to see the other places and reel statuses.</p>:
   bucket.reels.filter(reel=>category==='all'||reel.places.some(visiblePlace)).map(reel=><div className="shared-reel" key={reel.id}>
    <div className="shared-reel-head"><div><h3>{reel.title||reel.platform||'Saved reel'}</h3><p>{reel.creator&&<>{reel.creator} · </>}Added by {reel.addedBy.id===bucket.me.id?'you':reel.addedBy.name} · <a href={reel.url} target="_blank" rel="noopener noreferrer">Open the original<ExternalLink size={12} aria-hidden="true"/></a></p></div>
     {reel.canRemove&&<button type="button" className="text-button" aria-label={'Remove '+(reel.title||'this reel')} onClick={()=>remove(reel.id)}><Trash2 size={14} aria-hidden="true"/>Remove</button>}</div>
    {reel.status!=='ready'?<p className="shared-reel-status" role="status">{reel.message||STATUS[reel.status]}</p>:reel.message&&<p className="shared-reel-status" role="status">{reel.message}</p>}
    {(reel.omittedDetails||0)>0&&<p className="shared-reel-status" role="status">Partial result · {reel.omittedDetails} {reel.omittedDetails===1?'detail couldn’t':'details couldn’t'} be verified from this reel. {reel.places.length?'The supported places are listed below.':'We couldn’t identify any places confidently enough to list.'} Check the original for anything missing.</p>}
    {reel.status==='ready'&&reel.places.length===0&&!reel.omittedDetails&&<p className="shared-reel-status">No specific places were identified in this reel. Open the original to check what it covers.</p>}
    {(reel.status==='ready'||reel.status==='unavailable')&&<button type="button" className="secondary shared-retry" disabled={!!retrying} onClick={()=>retry(reel.id,reel.url)}>{retrying===reel.id?'Checking…':reel.status==='ready'?'Check reel again':'Try again'}</button>}
    {reel.places.length>0&&<ul className="shared-places">{reel.places.filter(visiblePlace).map(place=><li key={place.id} id={sharedPlaceAnchor(place.id)}><div><strong>{place.title}</strong><small>{[place.category,place.place].filter(Boolean).join(' · ')}</small>{place.quote&&<q>{place.quote}</q>}<PlaceMatch bucketId={bucket.id} trip={bucket.trip} place={{key:place.id,title:place.title,place:place.place,query:place.query,kind:place.kind,category:place.category}} source={{url:reel.url,creator:reel.creator,second:place.second}}/></div><Vote bucketId={bucket.id} place={place} onChanged={()=>load(true)}/></li>)}</ul>}
   </div>)}
   <p className="fine-print">“Last checked” is when ReelTrip last looked up this venue on Google Maps; the confidence label says whether the match is confirmed. It isn’t opening hours or availability. If a match looks wrong, choose Fix it; your fix shows for everyone in the bucket with your name.</p>
  </section>
  </div><aside className="shared-side-column" aria-label="Plan with your group">
  <GettingStarted bucket={bucket}/>
  <section className="shared-members" aria-labelledby="shared-members-heading"><h2 id="shared-members-heading">Who’s in · {bucket.members.length}/{bucket.maxMembers}</h2>
   <ul>{bucket.members.map(m=><li key={m.id}><span className="shared-avatar" aria-hidden="true">{[...m.name][0]?.toUpperCase()}</span>{m.name}{m.id===bucket.me.id&&' (you)'}{m.role==='owner'&&<small>owner</small>}</li>)}</ul>
   {full?<p className="fine-print">This bucket is full (6 people).</p>:link?<><p className="shared-step">Send this link to your group.</p><CopyLink url={link}/></>:<button type="button" className="secondary" onClick={invite}><Link2 size={15} aria-hidden="true"/>Invite someone</button>}
   {bucket.invites.length>0&&<details className="shared-invites"><summary>Active invite links · {bucket.invites.length}</summary><ul>{bucket.invites.map(i=><li key={i.id}>Expires {new Date(i.expiresAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}{i.canRevoke&&<button type="button" className="text-button" onClick={()=>revoke(i.id)}>Turn off</button>}</li>)}</ul></details>}
  </section>
  <TripDetails bucket={bucket} onSaved={()=>load(true)}/>
  <StayHandoff places={mapPlaces} fallbackArea={bucket.name} trip={bucket.trip} bucketId={bucket.id}/>
  <Shortlist bucket={bucket} onChanged={()=>load(true)}/>
  </aside></div>
  <DeleteBucket bucket={bucket}/>
 </article>;
}

// Start a group trip from nothing: a trip name, your name if this device has
// none, then straight into the bucket to invite people.
export function StartGroupTrip({member,onMember}:{member:{name:string}|null;onMember?:(m:{name:string})=>void}){
 const [trip,setTrip]=useState(''),[yourName,setYourName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [creationUncertain,setCreationUncertain]=useState(false);
 async function start(event:FormEvent){
  event.preventDefault();if(busy||creationUncertain)return;setBusy(true);setError('');
  try{
   if(!member){const m=await becomeMember(yourName);onMember?.(m);}
   const created=await createShared(trip,[]);
   location.assign('/shared?id='+created.id);
  }catch(e){setError(message(e));setCreationUncertain(e instanceof SharedError&&e.bucketMayExist);setBusy(false);}
 }
 return <section className="shared-share shared-start" aria-labelledby="start-trip-heading">
  <div className="shared-share-heading"><Users size={22} aria-hidden="true"/><div><h2 id="start-trip-heading">Start a group trip</h2><p>Make a bucket, send your group one link, and everyone adds reels and votes from their own phone. No accounts.</p></div></div>
  <form onSubmit={start}>
   <label className="shared-field" htmlFor="start-trip-name">Where are you going?<input id="start-trip-name" required maxLength={80} value={trip} onChange={e=>setTrip(e.target.value)} placeholder="e.g. Lisbon in May"/></label>
   {!member&&<NameField id="start-your-name" value={yourName} onChange={setYourName}/>}
   <button className="primary" type="submit" disabled={busy||creationUncertain||!trip.trim()||(!member&&!yourName.trim())}>{busy?'Creating…':'Create the bucket'}</button>
  </form>
  {error&&<p className="upload-error" role="alert">{error}</p>}
  {creationUncertain&&<a className="secondary" href="/shared">Check your shared buckets</a>}
  <p className="fine-print">{member?<>You’ll be the owner, as <strong>{member.name}</strong>. </>:'ReelTrip remembers you on this device with a cookie; your name is shown only to people in your buckets. '}<a href="/privacy">What ReelTrip stores</a></p>
 </section>;
}

// Join by pasting an invite link: how the iPhone app (its own cookie store,
// separate from Safari) joins a bucket, and handy on any device.
export function PasteInvite(){
 const [value,setValue]=useState(''),[error,setError]=useState('');
 function go(event:FormEvent){
  event.preventDefault();
  const token=tokenFromHash(value.trim().replace(/^[^#]*#/,'#'));
  if(!token){setError('That isn’t a whole invite link. Copy the full link, including the part after #, and paste it again.');return;}
  location.assign('/join#'+token);
 }
 return <form className="shared-paste" onSubmit={go}><label className="shared-field" htmlFor="paste-invite">Been sent an invite link? Paste it here<input id="paste-invite" inputMode="url" autoComplete="off" value={value} onChange={e=>{setValue(e.target.value);setError('');}} placeholder="https://…/join#…" aria-invalid={!!error} aria-describedby={error?'paste-invite-error':undefined}/></label><button className="secondary" disabled={!value.trim()}>Open invite</button>{error&&<p id="paste-invite-error" className="shared-inline-error" role="alert">{error}</p>}</form>;
}

export function SharedBucketList(){
 const [buckets,setBuckets]=useState<SharedSummary[]|null>(null),[member,setMember]=useState<{name:string}|null|undefined>(undefined),[error,setError]=useState(''),[deleted,setDeleted]=useState(false);
 useEffect(()=>{setDeleted(new URLSearchParams(location.search).get('deleted')==='1');},[]);
 useEffect(()=>{me().then(m=>{setMember(m);if(m)return listShared().then(setBuckets);setBuckets([]);}).catch(e=>setError(message(e)+' Reload the page to try again.'));},[]);
 return <section aria-labelledby="shared-list-heading"><div className="eyebrow">PLAN TOGETHER</div><h1 id="shared-list-heading">Shared buckets</h1>
  <p className="reservation-intro">A shared bucket is one trip that 2–6 people fill from their own phones: add the reels you’ve saved, vote on the places, agree a shortlist and open the booking links.</p>
  {deleted&&<p className="inline-message" role="status">Bucket deleted, with everything linked to it.</p>}
  {error&&<p className="inline-message" role="alert">{error}</p>}
  {buckets===null?<p role="status">Loading…</p>:<>
   {buckets.length>0&&<ul className="shared-list">{buckets.map(b=><li key={b.id}><a href={'/shared?id='+b.id}><strong>{b.name}</strong><span>{b.members} {b.members===1?'person':'people'} · {b.reels} {b.reels===1?'reel':'reels'} · {b.role}</span></a></li>)}</ul>}
   {member!==undefined&&<StartGroupTrip member={member} onMember={setMember}/>}
   <PasteInvite/>
   {buckets.length===0&&<p className="fine-print">Already planning on your own? Open one of <a href="/trips">your buckets</a> and choose Share this bucket.</p>}
  </>}
 </section>;
}

export function JoinInvite(){
 const [token,setToken]=useState<string|null|undefined>(undefined),[inApp,setInApp]=useState(false),[preview,setPreview]=useState<InvitePreview|null>(null),[error,setError]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setInApp(hasNativeBridge());const value=location.hash.replace(/^#/,'');const valid=/^[0-9a-f]{64}$/.test(value)?value:null;setToken(valid);if(valid)previewInvite(valid).then(setPreview).catch(e=>setError(message(e)));},[]);
 async function join(event:FormEvent){
  event.preventDefault();if(!token||busy)return;setBusy(true);setError('');
  try{const result=await joinShared(token,preview?.me?undefined:name);if(result.joined)track('member_joined',{},result.bucketId);location.assign('/shared?id='+result.bucketId);}catch(e){setError(message(e));setBusy(false);}
 }
 if(token===undefined)return <p role="status">Opening your invite…</p>;
 if(!token)return <div className="library-empty" role="alert"><h1>This invite link is incomplete</h1><p>Ask whoever sent it for the full link, or a new one.</p></div>;
 if(error&&!preview)return <div className="library-empty" role="alert"><h1>We couldn’t open this invite</h1><p>{error}</p><a className="secondary" href="/">Go to ReelTrip</a></div>;
 if(!preview)return <p role="status">Opening your invite…</p>;
 if(preview.alreadyMember&&preview.bucketId)return <div className="shared-join"><h1>You’re already in {preview.bucketName}</h1><a className="primary" href={'/shared?id='+preview.bucketId}>Open the bucket</a></div>;
 const owner=preview.ownerName?preview.ownerName+'’s ':'';
 return <section className="shared-join" aria-labelledby="join-heading"><div className="eyebrow">YOU’RE INVITED</div><h1 id="join-heading">Join {owner}{preview.bucketName} bucket</h1>
  <p className="reservation-intro">{preview.members} of {preview.maxMembers} people {preview.members===1?'has':'have'} joined. Add reels from your phone and vote on the places you want to go.</p>
  {!preview.full&&!preview.me&&!inApp&&<p className="fine-print shared-app-hint">Have the ReelTrip iPhone app? Join in the app instead, so you can share reels straight from Instagram or TikTok: copy this link, open ReelTrip → Shared, and paste it.</p>}
  {preview.full?<p className="inline-message" role="alert">This bucket already has 6 people, the most a shared bucket can hold. If you’re meant to be in it, ask the owner to start a new bucket for the group.</p>:
  <form onSubmit={join}>{preview.me?<p>You’ll join as <strong>{preview.me.name}</strong>.</p>:<NameField id="join-name" value={name} onChange={setName}/>}
   <button className="primary" type="submit" disabled={busy}>{busy?'Joining…':'Join the bucket'}</button></form>}
  {error&&<p className="upload-error" role="alert">{error}</p>}
  <p className="fine-print">ReelTrip remembers you on this device with a cookie. Your name is shown only to people in buckets you join. No email or password needed. <a href="/privacy">What ReelTrip stores</a></p>
 </section>;
}
