'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,Bookmark,CalendarDays,CheckCircle2,ChevronDown,Film,FolderPlus,Library,Link2,MapPin,Plus,Sparkles,Trash2,Users,Utensils,X} from 'lucide-react';
import rawCatalog from '@/lib/catalog.json';
import {addReels,addUploadedReel,analysisPhase,analysisStageLabel,LIBRARY_KEY,readLibrary,reelID,type AnalysisPhase,type Reel} from '@/lib/reel-library';
import type {VideoAnalysis,VideoSource,ExtractClip} from '@/lib/analysis';
import {BUCKETS_KEY,readBuckets,createBucket,assignReel,removeBucket,combineBuckets,type ReelBucket} from '@/lib/reel-buckets';
import {sharedLinks} from '@/lib/shared-links';
import {matches,validateDates,diningSelection,diningDays,type Match,type Trip} from '@/lib/travel';
import {Landscape} from '@/components/landscape';
import {ReelPreview} from '@/components/reel-preview';
import {ItineraryView} from '@/components/itinerary';
import {ProviderLinks} from '@/components/provider-links';
import {nativeLibrary} from '@/lib/native-library';
import {useReelAnalysis} from '@/components/use-reel-analysis';
import {NATIVE_REELS_IMPORTED,type NativeReelsImportedEvent} from '@/lib/native-share';
import {queuedReels} from '@/lib/analysis-cache';
import {calendarDayIn} from '@/lib/calendar-day';
import {useTrips} from '@/components/trip-buckets';
import {openReelUpload} from '@/components/reel-upload';
import {writableLibrary,writableBundles,updateBundles,removeSavedReel} from '@/lib/reel-import';
import {track} from '@/lib/track';
import {WorkspaceHeader} from '@/components/workspace-navigation';
import {LibraryCover} from '@/components/library-cover';
import {getTripReels} from '@/lib/trip-buckets';
import {libraryAssignment,type LibraryAssignment} from '@/lib/library-assignment';
import {tripChatPreferences} from '@/lib/trip-planning';
import {BundleChat} from '@/components/bundle-chat';
import {diningHighlight} from '@/lib/dining-highlights';
import {TravelConnections} from '@/components/travel-connections';
import {useInterests} from '@/components/interested';
import {itemForMatch,interestKey} from '@/lib/interested';
import {recordActivity} from '@/lib/activity';
import {WORKSPACE_RETURN_KEY,readWorkspaceReturn} from '@/lib/workspace-return';
type Source=VideoSource;
const catalog=rawCatalog as VideoSource[];
const KEY='reeltrip-guest-v1';
const defaults=():Trip=>({prompt:'',selected:[],dates:[{start:'',end:''}],activeDate:0,adults:2,currency:'GBP',diningTime:'19:00'});
const names:Record<string,string>={ella:'Three days in Ella',sigiriya:'A slower side of Sigiriya',kanisha:'The Sri Lanka adventure',shreya:'South-coast state of mind','fitnomads-repeat':'A fresh take on Sri Lanka'};
const summaries:Record<string,string>={ella:'Waterfalls, hilltop views and cafés around Nine Arch Bridge.',sigiriya:'Sunrise hikes, village cycling and a safari near Sigiriya.',kanisha:'Temples, tea country and a scenic train journey through Sri Lanka.',shreya:'Beach days, good food and evenings out on the south coast.','fitnomads-repeat':'Surf spots, food stops and ideas for a slower Sri Lanka trip.'};
const stamp=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
const dateIn=(n:number)=>calendarDayIn(n);
const sourceFor=(reel:Reel)=>catalog.find(s=>reelID(s.source_url)===reel.id);
function External({href,children,className=''}:{href:string;children:React.ReactNode;className?:string}){return <a href={href} className={className} target="_blank" rel="noopener noreferrer">{children}</a>;}
export default function Home(){
 const background=useReelAnalysis();
 const interests=useInterests();
 const trips=useTrips(),currentTrip=trips.activeTrip;
 const [sessionTrips,setSessionTrips]=useState<Record<string,Partial<Trip>>>({});
 const [itineraryScope,setItineraryScope]=useState<string|null>(null);
 const [mergeOpen,setMergeOpen]=useState(false),[mergeIds,setMergeIds]=useState<string[]>([]),[mergeName,setMergeName]=useState('');
 const foreground=useRef<{reel:Reel;bundle:ReelBucket|null}|null>(null);
 const [library,setLibrary]=useState<Reel[]>([]),[ready,setReady]=useState(false),[page,setPage]=useState<'library'|'analysis'>('library');
 const [active,setActive]=useState<Reel|null>(null),[detail,setDetail]=useState<Reel|null>(null),[source,setSource]=useState<Source|null>(null),[phase,setPhase]=useState<AnalysisPhase>('idle');
 const [analyses,setAnalyses]=useState<VideoAnalysis[]>([]),[stage,setStage]=useState('');
 const [buckets,setBuckets]=useState<ReelBucket[]>([]),[bucketName,setBucketName]=useState(''),[selectedBucket,setSelectedBucket]=useState('');
 const [collection,setCollection]=useState<ReelBucket|null>(null),[collectionProgress,setCollectionProgress]=useState<{reel:Reel;state:string;message:string}[]>([]);
 const [guestTrip,setTrip]=useState<Trip>(defaults),[saved,setSaved]=useState<string[]>([]),[notice,setNotice]=useState(''),[analysisError,setAnalysisError]=useState('');
 const [filter,setFilter]=useState('All'),[run,setRun]=useState(0),[showItinerary,setShowItinerary]=useState(false);
 const [evidence,setEvidence]=useState<Source|null>(null),[help,setHelp]=useState(false);
 const [assignment,setAssignment]=useState<LibraryAssignment|null>(null),[assignmentTrip,setAssignmentTrip]=useState(''),[assignmentError,setAssignmentError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),focusReturn=useRef<HTMLElement|null>(null),requestID=useRef(0);
 const itineraryRef=useRef<HTMLDivElement>(null);
 const trip:Trip=currentTrip?{...defaults(),...sessionTrips[currentTrip.id],selected:guestTrip.selected,prompt:currentTrip.brief,dates:currentTrip.dates,activeDate:currentTrip.activeDate,adults:currentTrip.adults,currency:currentTrip.currency}:guestTrip;
 const tripInterests=currentTrip?interests.items.filter(i=>currentTrip.interestIds.includes(i.id)):[];
 const dates=trip.dates[trip.activeDate]||trip.dates[0],meal=diningSelection(trip);
 let datesApplied=false;try{validateDates([dates]);datesApplied=phase==='ready';}catch{}
 const related=analyses.flatMap(a=>a.matches);
 const itineraryAnalysis=collection?analyses:analyses[0]&&(analyses[0].source.analysis_kind==='ai'||!['ella','sigiriya','shreya','kanisha'].includes(analyses[0].source.id))?analyses[0]:undefined;
 const bucket=buckets.find(b=>b.id===selectedBucket);
 const visibleLibrary=bucket?library.filter(r=>bucket.reelIds.includes(r.id)):library;
 function update(p:Partial<Trip>){
  if(!currentTrip){setTrip(t=>({...t,...p}));return true;}
  const patch={...(p.prompt!==undefined?{brief:p.prompt}:{}),...(p.dates?{dates:p.dates}:{}),...(p.activeDate!==undefined?{activeDate:p.activeDate}:{}),...(p.adults!==undefined?{adults:p.adults}:{}),...(p.currency?{currency:p.currency}:{})};
  if(Object.keys(patch).length&&!trips.update(currentTrip.id,patch))return false;
  setSessionTrips(t=>({...t,[currentTrip.id]:{...t[currentTrip.id],...p}}));return true;
 }
 function chooseTrip(item:LibraryAssignment){setDetail(null);setAssignment(item);setAssignmentTrip(currentTrip?.id||trips.trips[0]?.id||'');setAssignmentError('');}
 function addToTrip(){
  if(!assignment)return;
  try{
   if(assignment.kind==='reel')ensureReelSaved(assignment.reel);
   const {trip:target,patch}=libraryAssignment(localStorage,assignmentTrip,assignment);
   if(trips.update(target.id,patch)){close();setNotice('Added to '+target.name+'. Find it in Buckets when you’re ready to plan.');}
  }catch(e){setAssignmentError((e as Error).message);}
 }
 function viewAnalysis(reel:Reel){try{ensureReelSaved(reel);void planReel(reel);}catch(e){setNotice((e as Error).message);}}

 function ensureReelSaved(reel:Reel){const current=writableLibrary(localStorage);if(current.some(r=>r.id===reel.id))return;const next=reel.platform==='Uploaded video'?addUploadedReel(current,reel):addReels(current,[reel.url]);localStorage.setItem(LIBRARY_KEY,JSON.stringify(next));setLibrary(next);window.dispatchEvent(new Event('reeltrip:library-changed'));if(reel.platform!=='Uploaded video')try{nativeLibrary({action:'save',urls:[reel.url]});}catch{setNotice('Reel saved here. Reopen ReelTrip to finish syncing with the iPhone app.');}}
 function storeBuckets(change:(current:ReelBucket[])=>ReelBucket[]){const next=updateBundles(localStorage,change);setBuckets(next);window.dispatchEvent(new Event('reeltrip:bundles-changed'));return next;}
 function newBucket(){try{const next=storeBuckets(current=>createBucket(current,bucketName));setSelectedBucket(next.at(-1)!.id);setBucketName('');}catch(e){setNotice((e as Error).message);}}
 function setMembership(bucketId:string,reelId:string,include:boolean){try{storeBuckets(current=>assignReel(current,bucketId,reelId,include));}catch(e){setNotice((e as Error).message);}}
 function breakdown(clip:ExtractClip):VideoAnalysis{
  const reviewed=catalog.find(s=>s.id===clip.source?.id);
  if(reviewed)return {source:reviewed,matches:matches.filter(m=>m.source===reviewed.id)};
  if(clip.source?.analysis_kind==='ai'&&Array.isArray(clip.matches))return {source:clip.source,matches:clip.matches};
  throw new Error('The returned breakdown could not be verified.');
 }
 function beginPlan(reel:Reel,bucket:ReelBucket|null){
  try{sessionStorage.setItem(WORKSPACE_RETURN_KEY,JSON.stringify({version:1,reelId:reel.id,...(bucket?{bundleId:bucket.id}:{})}));}catch{}
  const id=++requestID.current;foreground.current={reel,bundle:bucket};
  setActive(reel);setCollection(bucket);setDetail(null);setSource(null);setAnalyses([]);setStage('');setPage('analysis');setPhase('loading');setAnalysisError('');setFilter('All');setShowItinerary(false);setRun(0);setTrip(t=>({...t,selected:[]}));window.scrollTo({top:0});
  return id;
 }
 function openLibrary(){requestID.current++;foreground.current=null;setPage('library');}
 async function planReel(reel:Reel,retry=false){
  const id=beginPlan(reel,null);setCollectionProgress([]);
  try{
   const clip=await background.ensure(reel,retry);
   if(id!==requestID.current)return;
   const next=analysisPhase(clip.status);
   if(next==='ready'){const result=breakdown(clip);setSource(result.source);setAnalyses([result]);setTrip(t=>({...t,selected:[result.source.id]}));}
   setAnalysisError(clip.message||'');setPhase(next);
  }catch(e){if(id===requestID.current){setPhase('error');setAnalysisError((e as Error).message);}}
 }
 async function planCollection(chosen:ReelBucket,savedReels=library,retry=false){
  const reels=chosen.reelIds.map(id=>savedReels.find(r=>r.id===id)).filter((r):r is Reel=>!!r);
  if(!reels.length){setNotice('Add reels to this bundle before planning it.');return;}
  if(reels.length!==chosen.reelIds.length){setNotice('Some collection reels are missing from this device. Use Remove missing reels before planning.');return;}
  const id=beginPlan(reels[0],chosen),completed:VideoAnalysis[]=[];
  const progress=reels.map(reel=>({reel,state:'Waiting',message:''}));setCollectionProgress([...progress]);
  let failed=false;
  for(let i=0;i<reels.length;i++){
   if(id!==requestID.current)return;
   progress[i].state='Analysing';setCollectionProgress(progress.map(p=>({...p})));
   try{
    const clip=await background.ensure(reels[i],retry);
    if(id!==requestID.current)return;
    if(analysisPhase(clip.status)!=='ready')throw new Error(clip.message||(clip.status==='not_travel'||clip.status==='reference_reviewed'?'This reel has no travel breakdown.':'This reel could not be analysed yet.'));
    const result=breakdown(clip);completed.push(result);setAnalyses([...completed]);setSource(completed[0].source);progress[i].state='Ready';progress[i].message=result.source.title;
   }catch(e){if(id!==requestID.current)return;failed=true;progress[i].state='Needs attention';progress[i].message=(e as Error).name==='TimeoutError'?'Still processing. Retry this bundle to check again.':(e as Error).message;}
   setCollectionProgress(progress.map(p=>({...p})));
  }
  if(id!==requestID.current)return;
  setTrip(t=>({...t,selected:completed.map(a=>a.source.id)}));setPhase(failed?'error':'ready');
  setAnalysisError(failed?'Every reel needs a travel breakdown before we can combine this bundle. Retry, or change the reels in your bundle. No reel has been silently left out.':'');
 }
 useEffect(()=>{
  if(page!=='analysis'||!active||collection)return;
  const entry=background.cache[active.id];if(!entry)return;
  if(entry.status==='working'){setStage(entry.clip?.stage||'');setPhase('loading');setAnalysisError('');return;}
  // Another mounted screen can finish or retry this reel. Its cache generation
  // is authoritative over a foreground promise waiting on an earlier run.
  requestID.current++;
  if(entry.status==='error'){setPhase('error');setAnalysisError(entry.message||'This reel could not be analysed yet.');return;}
  if(!entry.clip)return;
  try{
   const next=analysisPhase(entry.clip.status);
   if(next==='ready'){const result=breakdown(entry.clip);setSource(result.source);setAnalyses([result]);setTrip(trip=>({...trip,selected:[result.source.id]}));}
   setPhase(next);setAnalysisError(entry.clip.message||'');
  }catch(error){setPhase('error');setAnalysisError((error as Error).message);}
 },[background.cache,active,collection,page]);
 useEffect(()=>{
  let restored:Reel[]=[];try{restored=readLibrary(localStorage.getItem(LIBRARY_KEY));}catch{setNotice('Browser storage is unavailable. Saved reels cannot be restored.');}
  background.restore(restored);
  try{const old=JSON.parse(localStorage.getItem(KEY)||'null');if(old?.trip?.dates?.length&&old.trip.dates.length<=3){const t={...defaults(),...old.trip,selected:[],activeDate:Number.isInteger(old.trip.activeDate)&&old.trip.activeDate>=0&&old.trip.activeDate<old.trip.dates.length?old.trip.activeDate:0};try{validateDates(t.dates);}catch{t.dates=[{start:'',end:''}];t.activeDate=0;}setTrip(t);}if(Array.isArray(old?.saved))setSaved(old.saved.filter((id:string)=>matches.some(m=>m.id===id)));}catch{}
  const params=new URLSearchParams(window.location.search);
  if(params.get('help')==='1'){setHelp(true);window.history.replaceState(null,'',window.location.pathname);}
  if(params.get('share')==='1'){
   const incoming=sharedLinks(params);
   try{if(incoming.links.length){const before=writableLibrary(localStorage);restored=addReels(before,incoming.links);localStorage.setItem(LIBRARY_KEY,JSON.stringify(restored));setNotice('Saved to Reel Library.');
    for(const reel of restored)if(!before.some(old=>old.id===reel.id))track('reel_added',{source:'share',platform:reel.platform,destination:'individual',analyse:params.get('action')==='plan'});
    if(params.get('action')==='plan'){const item=restored.find(r=>r.id===reelID(incoming.links[0]));if(item)void planReel(item,true);}
   }else setNotice(incoming.message);}catch(e){setNotice((e as Error).message);}
   window.history.replaceState(null,'',window.location.pathname);
  }
  if(params.get('reel')){const reel=restored.find(r=>r.id===params.get('reel'));if(reel)setDetail(reel);else setNotice('This reel is no longer in this browser’s library.');window.history.replaceState(null,'',window.location.pathname);}
  setLibrary(restored);background.restore(restored);try{setBuckets(readBuckets(localStorage.getItem(BUCKETS_KEY)));}catch{}setReady(true);
  if(params.get('resume')==='1'){
   try{const resume=readWorkspaceReturn(sessionStorage.getItem(WORKSPACE_RETURN_KEY));const reel=restored.find(r=>r.id===resume?.reelId);if(reel&&!resume?.bundleId)void planReel(reel);else if(reel&&resume?.bundleId){const chosen=readBuckets(localStorage.getItem(BUCKETS_KEY)).find(b=>b.id===resume.bundleId);if(chosen){setSelectedBucket(chosen.id);void planCollection(chosen,restored);}}}catch{}
   window.history.replaceState(null,'',window.location.pathname);
  }
  const receiveImported=(event:Event)=>{
   const applied=(event as NativeReelsImportedEvent).detail,reels=applied.library;
   setLibrary(reels);setBuckets(applied.buckets);
   if(applied.messages.length)setNotice(applied.messages[0]);
   const current=foreground.current;
   if(applied.individual)void planReel(applied.individual);
   else if(current?.bundle&&current.bundle.reelIds.some(id=>applied.analyseIds.includes(id)))void planCollection(applied.buckets.find(bundle=>bundle.id===current.bundle!.id)||current.bundle,reels);
   else if(current&&!current.bundle&&applied.analyseIds.includes(current.reel.id))void planReel(current.reel);
  };
  const refreshLibrary=()=>{try{const fresh=writableLibrary(localStorage),bundles=writableBundles(localStorage);setLibrary(fresh);setBuckets(bundles);background.restore(fresh);}catch{setNotice('Your saved reels or bundles could not be read safely. Existing data has been kept unchanged.');}};
  const storageChanged=(event:StorageEvent)=>{if(event.key===null||event.key===LIBRARY_KEY||event.key===BUCKETS_KEY)refreshLibrary();};
  window.addEventListener('storage',storageChanged);window.addEventListener('focus',refreshLibrary);
  window.addEventListener('reeltrip:library-changed',refreshLibrary);window.addEventListener('reeltrip:bundles-changed',refreshLibrary);window.addEventListener('reeltrip:analysis-changed',refreshLibrary);
  window.addEventListener(NATIVE_REELS_IMPORTED,receiveImported);
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  return()=>{window.removeEventListener('storage',storageChanged);window.removeEventListener('focus',refreshLibrary);window.removeEventListener('reeltrip:library-changed',refreshLibrary);window.removeEventListener('reeltrip:bundles-changed',refreshLibrary);window.removeEventListener('reeltrip:analysis-changed',refreshLibrary);window.removeEventListener(NATIVE_REELS_IMPORTED,receiveImported);requestID.current++;foreground.current=null;};
 },[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(KEY,JSON.stringify({trip:guestTrip,saved}));}catch{setNotice('Browser storage is unavailable. Keep this page open to retain your current plan.');}},[ready,guestTrip,saved]);
 useEffect(()=>{
  if(!ready)return;
  // Queue every newly assigned reel; reuse the same promise if it is also opened for planning.
  let disposed=false;
  const queue=queuedReels(buckets.flatMap(b=>b.reelIds),library.filter(reel=>reel.autoAnalyse!==true),background.cache);
  async function drain(){while(queue.length&&!disposed){const reel=queue.shift()!;try{await background.ensure(reel);}catch{}}}
  void drain();void drain();return()=>{disposed=true;};
 },[ready,buckets,library]);
 function mergeBundles(){try{const next=storeBuckets(current=>combineBuckets(current,mergeIds,mergeName));setSelectedBucket(next.at(-1)!.id);setMergeOpen(false);setMergeIds([]);setMergeName('');setNotice('Combined bundle created. Original bundles are unchanged; duplicate reels appear once.');}catch(e){setNotice((e as Error).message);}}
 const modalOpen=!!(detail||evidence||help||assignment);
 useEffect(()=>{if(modalOpen){focusReturn.current=document.activeElement as HTMLElement;dialog.current?.showModal();}else if(dialog.current?.open){dialog.current.close();focusReturn.current?.focus();}},[modalOpen]);
 function close(){setDetail(null);setEvidence(null);setHelp(false);setAssignment(null);setAssignmentError('');}
 function remove(reel:Reel){try{const next=removeSavedReel(localStorage,reel.id);setBuckets(next.buckets);setLibrary(next.library);window.dispatchEvent(new Event('reeltrip:bundles-changed'));window.dispatchEvent(new Event('reeltrip:library-changed'));if(reel.platform!=='Uploaded video')nativeLibrary({action:'remove',url:reel.url});close();setNotice('Reel removed from this library.');}catch(error){setNotice(error instanceof Error?error.message:'Couldn’t update storage. Please try again.');}}
 function bookmark(id:string){setSaved(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);}
 function generate(){try{validateDates([dates]);if(!source||phase!=='ready')throw new Error('Finish analysing your reels before building an itinerary.');setItineraryScope(currentTrip?.id||'guest');setShowItinerary(true);setRun(n=>n+1);setTimeout(()=>itineraryRef.current?.scrollIntoView({behavior:'smooth'}),50);}catch(e){setNotice((e as Error).message);}}
 function providerLinks(m:Match){return <ProviderLinks match={m} dates={datesApplied?dates:undefined} adults={trip.adults} currency={trip.currency} meal={datesApplied?meal:undefined}/>;}
 function bundleMenu(r:Reel){return <details className="card-bundle-menu"><summary><FolderPlus size={15}/>Add to bundle<ChevronDown size={13}/></summary><div>{buckets.length?buckets.map(b=><label key={b.id}><input type="checkbox" checked={b.reelIds.includes(r.id)} onChange={e=>{try{ensureReelSaved(r);setMembership(b.id,r.id,e.target.checked);}catch(error){setNotice((error as Error).message);}}}/><span>{b.name}<small>{b.reelIds.length} / 12 reels</small></span></label>):<p>Create a bundle below to group your food finds or activity ideas.</p>}</div></details>;}
 function reelCard(r:Reel,example=false){const s=sourceFor(r),processing=background.cache[r.id],title=s?(names[s.id]||s.title):processing?.clip?.source?.title||r.title||r.platform+' reel';return <article className="reel-card" key={r.id}>
  <button className="reel-art" onClick={()=>setDetail(r)} aria-label={'Open '+title}><LibraryCover seed={s?.id||r.id}/><span className="platform">{r.platform}</span><span className="reel-art-label">Illustrative cover</span></button>
  <div className="reel-card-body">{!example&&<span className="status-pill">{processing?.status==='working'?'Analysing in background':processing?.status==='complete'||s?'Breakdown ready':processing?.status==='excluded'?'No travel breakdown':processing?.status==='error'?'Needs attention':'Saved reel'}</span>}<button className="reel-title" onClick={()=>setDetail(r)}>{title}</button><p className="reel-creator">{s?'@'+s.creator:r.platform+' · saved on this device'}</p>{s&&<p className="reel-summary">{summaries[s.id]||'Explore the places and experiences in this reviewed reel.'}</p>}{processing?.status==='error'&&<p role="status">{processing.message}</p>}<div className="reel-card-actions"><button className="primary" onClick={()=>chooseTrip({kind:'reel',reel:r})}><Plus size={16}/>Add to bucket</button><button className="text-button analysis-action" onClick={()=>viewAnalysis(r)}>View analysis<ArrowRight size={15}/></button>{bundleMenu(r)}</div></div>
 </article>;}
 return <div className="reel-app"><WorkspaceHeader active="library" onLibrary={openLibrary} onHelp={()=>setHelp(true)} onUpload={()=>openReelUpload({bundleId:(page==='analysis'?collection?.id:selectedBucket)||undefined})}/>
 <main className="reel-main"><div className="breadcrumb">Your workspace<span>/</span>{page==='library'?'Reel Library':'Video analysis'}</div>
 {page==='library'?<>
  <section className="library-hero"><div className="library-hero-copy"><div className="eyebrow">SAVE THE REEL. MAKE THE TRIP.</div><h1>Your next holiday,<br/><em>saved in one place.</em></h1><p>Keep the food finds, places and adventures you love. Bring them together into a bucket when you’re ready.</p><a className="library-group-start" href="/shared"><Users size={16} aria-hidden="true"/>Planning with friends? Start a group trip<ArrowRight size={14} aria-hidden="true"/></a>
   <section className="reel-import hero-reel-import" aria-label="Save a reel"><label>Paste a reel link</label><button className="hero-upload-entry" type="button" onClick={()=>openReelUpload({bundleId:selectedBucket||undefined})}><span><Link2 size={18}/>Instagram or TikTok video link</span><span className="primary"><Plus size={16}/>Upload reel</span></button><p>Paste a link or upload your own video. Choose where to save it and whether to analyse it.</p></section>
   <details className="phone-share-help"><summary>How to save from your phone</summary><ol><li>In Instagram, tap Send → More. In TikTok, tap Share → More.</li><li>Choose ReelTrip in the iPhone share sheet.</li><li>Choose Save to Reel Library, Analyse this reel or Add to a bundle.</li></ol><p>Already installed the ReelTrip app? Add it to Favourites under More → Edit in the share sheet. You can also paste a link here.</p></details>
  </div><div className="library-hero-art"><Landscape variant={3}/><span className="art-caption"><MapPin size={12}/>A little inspiration, illustrated</span></div></section>
  <nav className="library-hierarchy" aria-label="Your saved inspiration"><a href="#saved-reels"><Film size={18}/><span><strong>Reels <b>{library.length}</b></strong><small>Save your inspiration</small></span></a><span className="hierarchy-arrow" aria-hidden="true">→</span><a href="#saved-bundles"><FolderPlus size={18}/><span><strong>Bundles <b>{buckets.length}</b></strong><small>Group a theme</small></span></a><span className="hierarchy-arrow" aria-hidden="true">→</span><a href="/trips"><MapPin size={18}/><span><strong>Buckets <b>{trips.trips.length}</b></strong><small>Bring it all together</small></span></a></nav>
  {currentTrip&&<a className="library-current-trip" href="/trips"><span><strong>{currentTrip.name}</strong> · {currentTrip.bundleIds.length} bundles · {getTripReels(currentTrip,buckets,library).total} unique reels</span><span>Open bucket<ArrowRight size={14}/></span></a>}
  <section id="saved-reels" className="library-section saved-reels-section" aria-label="Reel Library"><div className="section-heading"><div><h2>{bucket?bucket.name:'Your reels'} <span>{visibleLibrary.length}</span></h2><p>{bucket?'Reels in this bundle.':'Your saved inspiration, ready when you are.'} Stored on this device.</p></div><div className="library-filter"><label htmlFor="library-bundle-filter">Show<select id="library-bundle-filter" value={selectedBucket} onChange={e=>setSelectedBucket(e.target.value)}><option value="">All saved reels</option>{buckets.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><Library size={22}/></div></div>
  {!visibleLibrary.length?<div className="library-empty"><Film size={28}/><h3>{bucket?'This bundle is ready for your finds.':'Your first reel starts here.'}</h3><p>{bucket?'Paste a link above, or choose Add to bundle on any saved reel.':'Paste a reel link above to save it here, or try one of the reviewed examples below.'}</p>{bucket&&<button className="secondary" onClick={()=>setSelectedBucket('')}>Show all saved reels</button>}</div>:<div className="reel-grid">{visibleLibrary.map(r=>reelCard(r))}</div>}</section>
  <section id="saved-bundles" className="library-section" aria-label="Reel bundles"><div className="section-heading"><div><h2>Your bundles <span>{buckets.length}</span></h2><p>Brain-dump your food finds or activity ideas into a bundle. Add the whole bundle to a bucket later. Up to 12 reels per bundle.</p></div></div>
   <form className="bundle-create-form" onSubmit={e=>{e.preventDefault();newBucket();}}><label htmlFor="collection-name">Give your bundle a name<input id="collection-name" value={bucketName} maxLength={80} placeholder="Sri Lanka food, Amsterdam activities…" onChange={e=>setBucketName(e.target.value)}/></label><button className="primary" disabled={!ready||!bucketName.trim()}><Plus size={16}/>Create bundle</button><span>{!bucketName.trim()?'Enter a name to create a bundle.':'Ready for your next great find.'}</span></form>
   {!buckets.length?<div className="bundle-empty"><div className="bundle-example" aria-label="Illustrative bundle example"><span className="eyebrow">EXAMPLE BUNDLE</span><Utensils size={27}/><h3>Sri Lanka food</h3><strong>8 reels</strong><p>A little collection of cafés, street food and dinner spots.</p></div><div><h3>Brain-dump your food reels here.</h3><p>Save every “we have to try this” in one place. Create your own bundle above, then add reels as you find them.</p><small>This example shows what a bundle could look like. It is not part of your library.</small></div></div>:<div className="bundle-card-grid">{buckets.map(b=>{const complete=b.reelIds.filter(id=>catalog.some(source=>reelID(source.source_url)===id)||['complete','excluded'].includes(background.cache[id]?.status)).length;return <article className={'bundle-card '+(selectedBucket===b.id?'selected':'')} key={b.id}><div className="bundle-card-icon"><FolderPlus size={24}/></div><h3>{b.name}</h3><p><strong>{b.reelIds.length} reels</strong> · {complete} analysed</p><div className="bundle-card-actions"><button className="primary" onClick={()=>chooseTrip({kind:'bundle',bundle:b})}><Plus size={16}/>Add to bucket</button><button className="text-button" disabled={!b.reelIds.length} onClick={()=>void planCollection(b)}>View analysis<ArrowRight size={15}/></button><button className="text-button" onClick={()=>{setSelectedBucket(b.id);document.getElementById('saved-reels')?.scrollIntoView({behavior:'smooth'});}}>View reels & manage</button></div>{!b.reelIds.length&&<small>Add a reel to start its analysis.</small>}</article>;})}</div>}
   {bucket&&<div className="bundle-manage"><div><h3>Managing {bucket.name}</h3><p>{bucket.reelIds.filter(id=>['complete','excluded'].includes(background.cache[id]?.status)).length} of {bucket.reelIds.length} reels processed{bucket.reelIds.some(id=>background.cache[id]?.status==='excluded')&&<> · {bucket.reelIds.filter(id=>background.cache[id]?.status==='excluded').length} without travel recommendations</>} · New reels are analysed automatically.</p><p>{[...new Set(bucket.reelIds.flatMap(id=>background.cache[id]?.clip?.matches?.map(m=>m.place)||[]))].slice(0,8).join(' · ')||'Your places will appear as analyses finish.'}</p></div><div className="state-actions">{bucket.reelIds.some(id=>!library.some(r=>r.id===id))&&<button className="secondary" onClick={()=>{try{storeBuckets(current=>{const saved=writableLibrary(localStorage);return current.map(b=>b.id===bucket.id?{...b,reelIds:b.reelIds.filter(id=>saved.some(r=>r.id===id))}:b);});setNotice('Missing reel references removed from this bundle.');}catch(e){setNotice((e as Error).message);}}}>Remove missing reels</button>}<button className="text-button" onClick={()=>{try{storeBuckets(current=>removeBucket(current,bucket.id));setSelectedBucket('');setNotice('Bundle removed. Your reels remain in Reel Library.');}catch(e){setNotice((e as Error).message);}}}>Remove bundle</button></div></div>}
   <div className="bundle-combine-control"><button className="secondary" disabled={buckets.length<2} onClick={()=>setMergeOpen(!mergeOpen)}>Combine bundles<ChevronDown size={15}/></button>{buckets.length<2&&<small>Create at least two bundles to combine them.</small>}</div>{mergeOpen&&<div className="bundle-combine"><h3>Combine your inspiration</h3><p>Choose two or more bundles. We’ll create a new bundle and keep each reel once. Your originals stay saved.</p><fieldset><legend>Bundles to combine</legend>{buckets.map(b=><label key={b.id}><input type="checkbox" checked={mergeIds.includes(b.id)} onChange={e=>setMergeIds(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/>{b.name} · {b.reelIds.length} reels</label>)}</fieldset><label htmlFor="combined-name">New bundle name</label><input id="combined-name" maxLength={80} value={mergeName} onChange={e=>setMergeName(e.target.value)} placeholder="Sri Lanka: food & nightlife"/><div className="state-actions"><button className="primary" disabled={mergeIds.length<2||!mergeName.trim()} onClick={mergeBundles}>Create combined bundle</button><button className="secondary" onClick={()=>setMergeOpen(false)}>Cancel</button></div><p className="fine-print">Select at least two bundles and enter a name to combine.</p></div>}
  </section>
  <section className="library-section reviewed-section" aria-label="Reviewed examples"><div className="section-heading"><div><div className="eyebrow">REVIEWED EXAMPLES · {catalog.length} REELS</div><h2>A little inspiration to get you started</h2><p>Explore these source-linked breakdowns. Examples count toward your library only when you save or use them.</p></div></div><div className="reel-grid">{catalog.map(s=>reelCard({id:reelID(s.source_url),url:s.source_url,platform:s.platform as Reel['platform'],addedAt:''},true))}</div></section>
 </>:<>
  <button className="back-link" onClick={openLibrary}><ArrowLeft size={16}/>Back to Reel Library</button>
  <div className="analysis-trip-scope">{active&&<button className="secondary" onClick={()=>chooseTrip(collection?{kind:'bundle',bundle:collection}:{kind:'reel',reel:active})}><Plus size={16}/>Add {collection?'bundle':'reel'} to bucket</button>}{trips.error&&<p role="alert">{trips.error}</p>}</div>
  <section className="analysis-hero"><div className="analysis-intro"><div className="eyebrow">VIDEO ANALYSIS</div><h1>From saved reel<br/><em>to your next trip.</em></h1><p>Find the places that caught your eye. Explore activities, reserve a table and make it yours.</p>{active&&<div className="active-reel"><Film size={20}/><div><strong>{collection?collection.name:source?(names[source.id]||source.title):active.platform+' reel'}</strong><span>{collection?collection.reelIds.length+' reels in this bundle':source?(source.platform==='Uploaded video'?'Your uploaded video':'@'+source.creator):'Saved in your Reel Library'}</span></div><External href={active.url}>{active.platform==='Uploaded video'?'Open uploaded video':'Watch original'}<ArrowUpRight size={14}/></External></div>}</div>{active&&!collection&&<ReelPreview key={active.id} url={source?.source_url||active.url} title={source?.title} creator={source?.creator} collapsed/>}</section>
  <ol className="analysis-steps"><li className="complete"><CheckCircle2 size={17}/>Reel saved</li><li className={phase==='ready'?'complete':''}><Film size={17}/>Places found</li><li className={datesApplied?'complete':''}><CalendarDays size={17}/>Dates & booking links</li></ol>
  {phase==='loading'&&<div className="analysis-state" role="status" aria-live="polite"><span className="loading-dot"/><h2>Preparing your reel breakdown</h2><p>{analysisStageLabel(stage)}</p><small>You can leave the page; your reel stays in the library. Open View analysis again to resume.</small></div>}
  {['unavailable','reference','not_travel','error'].includes(phase)&&<div className="analysis-state" role="status"><Film size={28}/><h2>{phase==='not_travel'?'No holiday recommendations found':phase==='reference'?'This reel is a design reference':phase==='unavailable'?'Your reel is saved. Its breakdown isn’t ready.':'We couldn’t load this breakdown'}</h2><p>{phase==='reference'?'This video covers UI tools, not a holiday. It stays in your library without invented travel recommendations.':analysisError||(phase==='not_travel'?'This video did not provide enough travel recommendations for a trip. It remains in your Reel Library.':'Video analysis is temporarily unavailable. Your reel is saved. Please try again later or explore a reviewed example.')}</p><div className="state-actions"><button className="secondary" onClick={openLibrary}>Open Reel Library</button>{active&&(phase==='error'||phase==='unavailable')&&<><button className="primary" onClick={()=>void (collection?planCollection(collection,library,true):planReel(active,true))}>Try again</button>{active.platform!=='Uploaded video'&&<button className="secondary" onClick={()=>openReelUpload({mode:'file',bundleId:collection?.id})}>Upload video file</button>}</>}</div>{active&&active.platform!=='Uploaded video'&&(phase==='error'||phase==='unavailable')&&<p className="fine-print">If you have a saved copy, upload it as a separate reel for analysis. Your original link stays in your library. Choose the same bundle or bucket in the upload form.</p>}</div>}
  {collection&&<section className="analysis-state" aria-label="Bundle analysis progress"><h2>{collection.name}</h2><p>Saved analyses are reused. Pending reels continue processing; chat can use the completed results while you wait.</p><ol>{collectionProgress.map(p=><li key={p.reel.id}><strong>{p.reel.platform} · {p.state}</strong> — {p.message||'Waiting to be analysed'} <External href={p.reel.url}>Original</External></li>)}</ol></section>}
  {active&&analyses.length>0&&<BundleChat bundle={collection||{id:active.id,name:source?.title||'This reel',reelIds:[active.id],createdAt:active.addedAt}} mode={collection?'bundle':'reel'} analyses={analyses} total={collection?.reelIds.length||1} interests={tripInterests} preferences={currentTrip?tripChatPreferences(currentTrip):undefined} tripId={currentTrip?.id} onApply={brief=>{if(update({prompt:brief}))setNotice('Preferences added. Choose your dates below to build the itinerary.');}}/>}
  {analyses.length>0&&source&&<>
   {phase==='ready'&&<details className="trip-settings"><summary><CalendarDays size={18}/><strong>Dates & guests</strong><span>{datesApplied?`${dates.start} → ${dates.end} · ${meal.covers} diners at ${meal.time}`:'Add dates to personalise your booking links'}</span></summary><section className="dates-section" aria-label="Dates and booking links"><div className="section-heading"><div><div className="eyebrow">MAKE IT YOUR HOLIDAY</div><h2>When would you like to go?</h2><p>Booking links update as you change your dates and guest count.</p></div></div><div className="planner"><div className="planner-top"><strong>Suggested travel dates</strong><button className="text-button" onClick={()=>update({dates:[{start:dateIn(30),end:dateIn(33)}],activeDate:0})}>Try a 3-night break next month</button></div><div className="planner-fields"><label>Arrival<input aria-label="Arrival date" type="date" min={dateIn(0)} value={dates.start} onChange={e=>update({dates:trip.dates.map((d,i)=>i===trip.activeDate?{...d,start:e.target.value}:d)})}/></label><label>Departure<input aria-label="Departure date" type="date" min={dates.start||dateIn(0)} value={dates.end} onChange={e=>update({dates:trip.dates.map((d,i)=>i===trip.activeDate?{...d,end:e.target.value}:d)})}/></label><label>Adults<select aria-label="Number of adults" value={trip.adults} onChange={e=>update({adults:+e.target.value})}>{[1,2,3,4,5,6,7,8].map(n=><option key={n}>{n}</option>)}</select></label><label>Currency<select aria-label="Currency" value={trip.currency} onChange={e=>update({currency:e.target.value})}>{['GBP','EUR','USD','INR'].map(c=><option key={c}>{c}</option>)}</select></label></div><div className="date-options">{trip.dates.map((d,i)=><button className={i===trip.activeDate?'date-selected':''} key={i} onClick={()=>update({activeDate:i})}>Option {i+1}{d.start?' · '+d.start:''}</button>)}{trip.dates.length<3&&<button onClick={()=>{try{validateDates([dates]);const shift=(v:string)=>new Date(Date.parse(v)+7*86400000).toISOString().slice(0,10);update({dates:[...trip.dates,{start:shift(dates.start),end:shift(dates.end)}],activeDate:trip.dates.length});}catch(e){setNotice((e as Error).message);}}}><Plus size={13}/>Compare dates</button>}</div><label className="trip-brief">Anything to make it yours?<textarea aria-label="Trip brief" placeholder="A relaxed pace, more food stops, a little adventure…" value={trip.prompt} onChange={e=>update({prompt:e.target.value.slice(0,1000)})}/></label>
    <div className="dining-fields"><label>Activity / dining day<select aria-label="Dining date" value={meal.date} onChange={e=>update({diningDate:e.target.value})}><option value="" disabled>Choose travel dates first</option>{diningDays(dates).map(d=><option key={d}>{d}</option>)}</select></label><label>Restaurant local time<input aria-label="Dining time" type="time" step="1800" value={meal.time} onChange={e=>update({diningTime:e.target.value})}/></label><label>Diners<select aria-label="Number of diners" value={meal.covers} onChange={e=>update({diners:+e.target.value})}>{Array.from({length:20},(_,i)=>i+1).map(n=><option key={n}>{n}</option>)}</select></label></div>
    <div className="dates-actions"><button className="primary" onClick={generate}><Sparkles size={16}/>Build my itinerary</button></div><p className="fine-print">Choose any dates you like. Suggested dates are a starting point, not a weather or price recommendation.</p></div>
   </section></details>}
   <section className="breakdown-links" aria-label="Places from this reel"><div className="section-heading"><div><div className="eyebrow">EXPLORE & BOOK</div><h2>Your next stops</h2><p><strong>{related.filter(m=>diningHighlight(m)==='mentioned'||diningHighlight(m)==='uncertain').length} café / restaurant mentions to explore</strong></p><p>Choose a place, compare options and continue to the provider to book.</p></div></div><div className="tabs" role="group" aria-label="Filter breakdown places">{['All','Experiences','Food','Stays','Transport','Saved'].map(f=><button className={filter===f?'active':''} key={f} onClick={()=>setFilter(f)}>{f==='Food'?'Restaurants':f==='Experiences'?'Activities':f}</button>)}</div><div className="analysis-matches">{related.filter(m=>filter==='All'||(filter==='Saved'?(currentTrip?tripInterests.some(i=>i.id===interestKey(itemForMatch(m))):(saved.includes(m.id)||(['Food','Experiences','Stays'].includes(m.category)&&interests.contains(itemForMatch(m))))):m.category===filter)).map(m=><article className="match-card" key={m.id}><div className="match-main"><div className="match-meta"><MapPin size={12}/>{m.place} · {m.category}</div><h3>{m.title}</h3><span className="match-kind">{m.kind}</span>{diningHighlight(m)&&<span className="dining-flag"><Utensils size={14}/>{diningHighlight(m)==='mentioned'?'Mentioned in the reel':diningHighlight(m)==='uncertain'?'Dining mention · confirm the name':'Suggested dining alternative'}</span>}{providerLinks(m)}<details className="place-evidence"><summary>Why this place?</summary><p className="match-note">{m.note||m.quote}</p><button className="evidence-link" onClick={()=>setEvidence(analyses.find(a=>a.source.id===m.source)?.source||null)}><Film size={12}/>Video evidence · {stamp(m.second)}</button></details></div>{(!['Food','Experiences','Stays'].includes(m.category)||(m.category==='Stays'&&saved.includes(m.id)))&&<button className={'save-button '+(saved.includes(m.id)?'is-saved':'')} aria-label={(saved.includes(m.id)?'Unsave ':'Save ')+m.title} onClick={()=>bookmark(m.id)}><Bookmark size={19} fill={saved.includes(m.id)?'currentColor':'none'}/></button>}</article>)}</div><p className="fine-print">Verified restaurant pages show a preview before you leave. Other links open provider searches; confirm the venue, dates, party size and availability on the provider’s website.</p></section>
   {phase==='ready'&&<TravelConnections key={currentTrip?.id||'unassigned'} trip={trip}/>}
<details className="source-details"><summary><Film size={18}/><strong>Reel details & practical tips</strong><span>Source timestamps, transport advice and things to check</span></summary>   <section className="analysis-breakdown" aria-label="Video breakdown"><div className="section-heading"><div><div className="eyebrow">SOURCE NOTES</div><h2>{collection?'Inside these reels':'Inside this reel'}</h2><p>{source.scope}</p><span className="status-pill">{analyses.some(a=>a.source.analysis_kind==='ai')?'Includes AI analysis · confirm place names':'Human-reviewed breakdown'}</span></div><button className="secondary" onClick={()=>setEvidence(source)}>Sources & unknowns</button></div>
    <div className="breakdown-layout"><div className="creator-days">{analyses.map(a=><div key={a.source.id}>{collection&&<div className="section-heading"><div><h3>{a.source.title}</h3><p>{a.source.platform==='Uploaded video'?'Your uploaded video':'@'+a.source.creator} · {a.source.analysis_kind==='ai'?'AI analysis':'Reviewed'}</p></div><button className="text-button" onClick={()=>setEvidence(a.source)}>Source</button></div>}{collection&&<ReelPreview url={a.source.source_url} title={a.source.title} creator={a.source.creator} collapsed/>}{a.source.days.map((day,dayIndex)=><article className="creator-day" key={dayIndex}><span className="creator-day-number">{day.day===0?'▶':String(day.day).padStart(2,'0')}</span><div><h3>{day.day===0?'Video highlights':'Creator’s day '+day.day}</h3>{day.items.map((item,i)=><div className="creator-stop" key={i}><span className="timestamp">{stamp(item.time_seconds[0])}</span><p>{item.details}</p></div>)}</div></article>)}</div>)}</div></div>
   </section>
   {analyses.some(a=>a.source.practical_tips?.length)&&<section className="practical-tips" aria-label="Practical tips from your reels"><div className="eyebrow">THE DETAILS THAT MAKE THE TRIP</div><h2>Timing, transport & creator tips</h2><p>Advice from the reel, with its source. Recheck schedules, costs and seasonal conditions before travelling.</p><div className="analysis-matches">{analyses.flatMap(a=>(a.source.practical_tips||[]).map((tip,i)=><article className="match-card" key={a.source.id+'-tip-'+i}><div className="match-main"><span className="status-pill">{tip.topic}</span><h3>{tip.subject}</h3><p>{tip.details}</p><button className="evidence-link" onClick={()=>setEvidence(a.source)}><Film size={12}/>Creator’s advice · {stamp(tip.time_seconds[0])}</button><details><summary>What the reel says</summary><p>{tip.quote}</p></details></div></article>))}</div></section>}
</details>
   {showItinerary&&itineraryScope===(currentTrip?.id||'guest')&&<div ref={itineraryRef}><ItineraryView key={(currentTrip?.id||'guest')+':'+(collection?.id||source.id)} scopeId={currentTrip?.id} trip={trip} run={run} analysis={itineraryAnalysis} onGenerate={generate} onGenerated={()=>setRun(0)} onSource={id=>setEvidence(analyses.find(a=>a.source.id===id)?.source||catalog.find(s=>s.id===id)||null)}/></div>}
  </>}
 </>}
 <footer><span className="footer-brand">reeltrip.</span><span>From your saved reels to your next story.</span><button onClick={()=>setHelp(true)}>How it works & privacy</button></footer></main>
 <dialog ref={dialog} onCancel={close} onClick={e=>{if(e.target===e.currentTarget)close();}}><div className="dialog-inner"><button autoFocus className="close" aria-label="Close dialog" onClick={close}><X size={20}/></button>
 {detail&&<><div className="eyebrow">REEL LIBRARY · {detail.platform}</div><h2>{sourceFor(detail)?(names[sourceFor(detail)!.id]||sourceFor(detail)!.title):detail.title||'Your saved reel'}</h2><p>{sourceFor(detail)?'@'+sourceFor(detail)!.creator:'Saved for your next adventure.'}</p><ReelPreview key={detail.id} url={detail.url} title={sourceFor(detail)?.title||detail.title} creator={sourceFor(detail)?.creator}/>{detail.upload&&<p className="fine-print">Original video retained until {new Date(detail.upload.expiresAt).toLocaleDateString('en-GB')}. Keep your own copy. A completed breakdown stays on this device.</p>}<p>View analysis opens this reel’s breakdown. Review its places and food recommendations before choosing your dates.</p><div className="state-actions"><button className="primary" onClick={()=>chooseTrip({kind:'reel',reel:detail})}><Plus size={16}/>Add to bucket</button><button className="secondary" onClick={()=>viewAnalysis(detail)}>View analysis<ArrowRight size={17}/></button></div>{buckets.length>0&&<fieldset><legend>Bundles</legend>{buckets.map(b=><label key={b.id} style={{display:'block',marginBlock:10}}><input type="checkbox" checked={b.reelIds.includes(detail.id)} onChange={e=>{try{ensureReelSaved(detail);setMembership(b.id,detail.id,e.target.checked);}catch(err){setNotice((err as Error).message);}}}/>{' '+b.name}</label>)}</fieldset>}{library.some(r=>r.id===detail.id)&&<button className="delete-reel" onClick={()=>remove(detail)}><Trash2 size={15}/>Remove from Reel Library</button>}</>}
 {assignment&&<div className="library-assignment"><div className="eyebrow">MAKE IT PART OF YOUR BUCKET</div><h2>Add {assignment.kind==='bundle'?'bundle':'reel'} to a bucket</h2><p>{assignment.kind==='bundle'?assignment.bundle.name:sourceFor(assignment.reel)?.title||assignment.reel.platform+' reel'}</p>{trips.trips.length?<><label htmlFor="assignment-trip">Choose a bucket<select id="assignment-trip" value={assignmentTrip} onChange={e=>{setAssignmentTrip(e.target.value);setAssignmentError('');}}>{trips.trips.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><p className="fine-print">Your originals stay in the library. A bucket can include up to 12 unique reels, including its bundles.</p><button className="primary" disabled={!assignmentTrip} onClick={addToTrip}><Plus size={16}/>Add to bucket</button></>:<><p>Create a bucket for your destination, then add the reels and bundles you’d like to explore.</p><a className="primary" href="/trips?new=1">Create a bucket<ArrowRight size={16}/></a></>}{(assignmentError||trips.error)&&<p className="interest-error" role="alert">{assignmentError||trips.error}</p>}</div>}
 {evidence&&<><div className="eyebrow">SOURCE EVIDENCE · {evidence.platform}</div><h2>{evidence.title}</h2><p>{evidence.platform==='Uploaded video'?'Your uploaded video':'@'+evidence.creator} · {evidence.scope}</p><ReelPreview key={evidence.id} url={evidence.source_url} title={evidence.title} creator={evidence.creator}/><p>{evidence.analysis_kind==='ai'?'AI analysis of sampled video frames, on-screen text, transcribed speech and captions. Not every frame is inspected; fast cuts or unclear names may be missed. Confirm place names before booking.':'Reviewed '+(evidence.method?.date||'previously')+' using audio and sampled frames.'} Timestamps refer to the clip.</p><h3>Still unknown</h3><ul>{evidence.unknowns.map(t=><li key={t}>{t}</li>)}</ul></>}
 {help&&<><div className="eyebrow">LESS SCROLLING. MORE GOING.</div><h2>A holiday starts with one reel.</h2><ol className="how-list"><li><strong>Save to Reel Library.</strong><p>In Instagram, tap Send, then More to open the iPhone share sheet. Choose ReelTrip, then tap Save as for Save to Reel Library, Analyse this reel or Add to a bundle. Add ReelTrip to Favourites under More → Edit in that share sheet. TikTok uses Share → More. On the website, paste a link.</p></li><li><strong>Add reels and bundles to a bucket.</strong><p>Choose Add to bucket to keep your ideas together. View analysis opens the breakdown, source timestamps, activity links and restaurants.</p></li><li><strong>Add dates after the breakdown.</strong><p>Prepare your booking links, then build an itinerary. Preview matched restaurant pages and complete reservations with the provider.</p></li></ol><p>Video analysis runs on ReelTrip’s servers; your phone needs no extra setup. Public videos may still be unavailable from their original platform. AI breakdowns are labelled separately from human-reviewed examples. Restaurant previews identify a booking destination. Check live availability and confirm bookings on the provider’s website.</p><h3>Your guest workspace</h3><p>Your Reel Library, dates, saved places and itinerary notes are stored on this device, with no cross-device account sync. Bundles stay on this device too. In the iPhone app, shared reels appear in the same Reel Library. Safari and other browsers have separate local storage. Once a share has reached our servers, analysis continues even if you close ReelTrip. Offline shares wait until you reopen the app with a connection.</p><p>Choose Save and analyse to start processing in the background, or Save only to keep a reel for later. Uploaded originals are private to this browser and retained for 7 days; keep your own copy. Uploaded breakdowns are cached on the server for 7 days after processing and remain saved on this device. Bundle chat sends the completed breakdowns and your conversation to our AI provider. The public video’s media may be processed by our AI provider and its breakdown cached on ReelTrip’s servers. Availability checks send dates and party details to connected providers. Search links share their search details with the provider.</p></>}
 </div></dialog>{notice&&<div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}</div>;
}
