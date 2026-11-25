'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,Film,Link2,Upload,X} from 'lucide-react';
import {useTrips} from '@/components/trip-buckets';
import {useTripSources} from '@/components/use-trip-sources';
import {useReelAnalysis} from '@/components/use-reel-analysis';
import {queuedReels,ANALYSIS_KEY} from '@/lib/analysis-cache';
import {uploadedReel,type Reel} from '@/lib/reel-library';
import {saveImportedReel,writableLibrary,writableBundles,type ReelDestination} from '@/lib/reel-import';
import {TRIPS_CHANGED,loadTrips,getTripReels} from '@/lib/trip-buckets';
import {sharedLinks} from '@/lib/shared-links';
import {uploadFileType} from '@/lib/uploaded-reel';
import {nativeLibrary} from '@/lib/native-library';
import {track} from '@/lib/track';
import {addSharedReel,listShared,me,type SharedSummary} from '@/lib/shared-client';

const OPEN='reeltrip:open-upload';
export function openReelUpload(options:{link?:string;bundleId?:string;mode?:'link'|'file'}={}){window.dispatchEvent(new CustomEvent(OPEN,{detail:options}));}
export function ReelUploadDialog(){
 const trips=useTrips(),sources=useTripSources(),background=useReelAnalysis();
 const [open,setOpen]=useState(false),[mode,setMode]=useState<'link'|'file'>('link'),[link,setLink]=useState(''),[file,setFile]=useState<File|null>(null),[target,setTarget]=useState('individual'),[analyse,setAnalyse]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stage,setStage]=useState(''),[dragging,setDragging]=useState(false),[uploaded,setUploaded]=useState<Reel|null>(null),[toast,setToast]=useState<{reel:Reel;message:string;syncPending?:boolean;fixed?:boolean}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),fileInput=useRef<HTMLInputElement>(null),returnFocus=useRef<HTMLElement|null>(null),activeTrip=useRef(trips.activeId),bundleIds=useRef(sources.bundles.map(b=>b.id));
 const request=useRef<AbortController|null>(null),alive=useRef(true);
 const [shared,setShared]=useState<SharedSummary[]>([]);
 activeTrip.current=trips.activeId;bundleIds.current=sources.bundles.map(b=>b.id);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();request.current=null;};},[]);
 useEffect(()=>{const show=(event:Event)=>{request.current?.abort();request.current=null;setBusy(false);const options=(event as CustomEvent<{link?:string;bundleId?:string;mode?:'link'|'file'}>).detail||{};returnFocus.current=document.activeElement as HTMLElement;setLink(options.link||'');setMode(options.mode||'link');setFile(null);setUploaded(null);setAnalyse(true);setError('');setStage('');setTarget(options.bundleId&&bundleIds.current.includes(options.bundleId)?'bundle:'+options.bundleId:activeTrip.current?'trip:'+activeTrip.current:'individual');setOpen(true);};window.addEventListener(OPEN,show);return()=>window.removeEventListener(OPEN,show);},[]);
 useEffect(()=>{if(open){dialog.current?.showModal();input.current?.focus();}else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus();}},[open]);
 // Shared buckets appear as destinations only on a device that has joined one.
 useEffect(()=>{if(!open)return;let live=true;me().then(member=>member?listShared():[]).then(list=>{if(live)setShared(list);}).catch(()=>{});return ()=>{live=false;};},[open]);
 useEffect(()=>{if(open){if(mode==='file')fileInput.current?.focus();else input.current?.focus();}},[open,mode]);
 useEffect(()=>{if(sources.ready)background.restore(sources.reels);},[sources.ready,sources.reels,background.restore]);
 useEffect(()=>{const refresh=()=>background.restore(sources.reels);const storage=(event:StorageEvent)=>{if(event.key===ANALYSIS_KEY||event.key===null)refresh();};window.addEventListener('reeltrip:analysis-changed',refresh);window.addEventListener('storage',storage);return()=>{window.removeEventListener('reeltrip:analysis-changed',refresh);window.removeEventListener('storage',storage);};},[sources.reels,background.restore]);
 useEffect(()=>{
  if(!sources.ready)return;let disposed=false;
  const queue=queuedReels(sources.reels.filter(reel=>reel.autoAnalyse===true).map(reel=>reel.id),sources.reels,background.cache);
  async function drain(){while(queue.length&&!disposed){const reel=queue.shift()!;try{await background.ensure(reel);}catch{}}}
  void drain();void drain();return()=>{disposed=true;};
 },[sources.ready,sources.reels]);
 function chooseFile(value:File|null){setError('');setUploaded(null);if(!value){setFile(null);return;}try{uploadFileType(value);setFile(value);}catch(error){setFile(null);setError((error as Error).message);}}
 function cancelUpload(){request.current?.abort(new DOMException('Upload cancelled. Your file and destination are kept so you can retry.','AbortError'));}
 function dismiss(){if(request.current){cancelUpload();return;}setOpen(false);}
 function retrySync(){if(!toast)return;try{if(nativeLibrary({action:'save',urls:[toast.reel.url]}))setToast(current=>current?.reel.id===toast.reel.id?{...current,syncPending:false}:current);}catch{/* Keep the saved success and offer sync again. */}}
 async function save(){
  if(busy||request.current)return;const controller=new AbortController();request.current=controller;setError('');setStage('');setBusy(true);
  const check=()=>{controller.signal.throwIfAborted();if(!alive.current||request.current!==controller)throw new DOMException('Upload replaced.','AbortError');};
  try{
   const sharedId=target.startsWith('shared:')?target.slice(7):null,sharedBucket=sharedId?shared.find(b=>b.id===sharedId):null;
   if(sharedId&&!sharedBucket)throw new Error('That shared bucket is no longer available. Choose another destination.');
   if(sharedId&&mode==='file')throw new Error('Uploaded videos stay private to this browser. Paste an Instagram or TikTok link to add a reel to a shared bucket.');
   // A reel for a shared bucket is also kept in this device’s library as an individual reel.
   const destination:ReelDestination=sharedId?{kind:'individual'}:target.startsWith('bundle:')?{kind:'bundle',id:target.slice(7)}:target.startsWith('trip:')?{kind:'trip',id:target.slice(5)}:{kind:'individual'};
   const existing=writableLibrary(localStorage);if(existing.length>=100&&mode==='file'&&!uploaded)throw new Error('Your library is full. Remove a reel before uploading another video.');
   if(destination.kind==='bundle'){const bundle=writableBundles(localStorage).find(b=>b.id===destination.id);if(!bundle)throw new Error('That bundle is no longer saved. Choose another destination.');if(mode==='file'&&!uploaded&&bundle.reelIds.length>=12)throw new Error('This bundle already has 12 reels. Choose another destination before uploading.');}
   if(destination.kind==='trip'){const trip=loadTrips(localStorage).trips.find(trip=>trip.id===destination.id);if(!trip)throw new Error('That bucket is no longer saved. Choose another destination.');if(mode==='file'&&!uploaded&&getTripReels(trip,writableBundles(localStorage),existing).total>=12)throw new Error('This bucket already has 12 reels. Choose another destination before uploading.');}
   let incoming:string|Reel;
   if(mode==='link'){
    const links=sharedLinks(new URLSearchParams({text:link})).links;if(links.length!==1)throw new Error('Paste one individual Instagram or TikTok video link.');incoming=links[0];
   }else{
    if(!file&&!uploaded)throw new Error('Choose an MP4, MOV or WebM video first.');
    if(uploaded)incoming=uploaded;
    else{
     const mime=uploadFileType(file!);setStage('Uploading and checking your video…');
     let abort=()=>{};
     const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});});
     const timer=setTimeout(()=>controller.abort(new DOMException('The upload took too long. Your file and destination are kept. Check your connection and retry.','TimeoutError')),300000);
     const transfer=async()=>{
      const response=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':mime,'X-Reel-Filename':encodeURIComponent(file!.name),'X-Reel-Size':String(file!.size)},body:file,signal:controller.signal});
      const data=await response.json().catch(()=>({error:'The server could not accept this upload. Try a smaller video or try again.'})) as {error?:unknown;reel?:unknown};check();if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'The upload could not be completed. Please try again.');
      return uploadedReel(data.reel);
     };
     try{incoming=await Promise.race([transfer(),interrupted]);check();setUploaded(incoming);}
     finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
    }
   }
   check();setStage('Saving to your library…');const result=saveImportedReel(localStorage,incoming,destination,analyse);
   track('reel_added',{source:mode==='file'?'upload':'link',platform:result.reel.platform,destination:destination.kind,analyse},destination.kind==='trip'?destination.id:undefined);
   background.restore(result.library);
   if(analyse)void background.ensure(result.reel,true).catch(()=>{});
   window.dispatchEvent(new Event('reeltrip:library-changed'));window.dispatchEvent(new Event('reeltrip:bundles-changed'));window.dispatchEvent(new Event(TRIPS_CHANGED));
   let syncPending=false;if(result.reel.platform!=='Uploaded video')try{nativeLibrary({action:'save',urls:[result.reel.url]});}catch{syncPending=true;}
   let sharedMessage='';
   if(sharedId&&sharedBucket){setStage('Adding it to '+sharedBucket.name+'…');try{const added=await addSharedReel(sharedId,result.reel.url);check();sharedMessage=added.added?'Added to '+sharedBucket.name+' for everyone.':'It was already in '+sharedBucket.name+'.';}catch(error){check();sharedMessage='Saved here, but it could not be added to '+sharedBucket.name+': '+(error as Error).message;}}
   setToast({reel:result.reel,syncPending,fixed:!!sharedMessage,message:sharedMessage||(analyse?'Reel saved. Analysis is starting in the background.':'Reel saved. You can analyse it whenever you’re ready.')});setOpen(false);setFile(null);setUploaded(null);setLink('');
  }catch(error){if(alive.current&&request.current===controller)setError((error as Error).message||'Your reel could not be saved. Try again.');}finally{if(alive.current&&request.current===controller){request.current=null;setBusy(false);setStage('');}}
 }
 const working=toast?background.cache[toast.reel.id]:null;
 const feedback=toast&&(toast.fixed?toast.message:working?.status==='complete'?'Your reel’s breakdown is ready.':working?.status==='error'?'Reel saved. Analysis needs attention; open it to retry.':working?.status==='excluded'?'Reel saved. No travel breakdown was found.':working?.status==='working'?'Reel saved. Analysing in the background…':toast.message);
 return <><dialog className="reel-upload-dialog" aria-labelledby="reel-upload-title" ref={dialog} onCancel={event=>{event.preventDefault();dismiss();}} onClick={event=>{if(event.target===event.currentTarget)dismiss();}}><div className="reel-upload-inner"><button className="upload-close" type="button" disabled={busy} onClick={dismiss} aria-label="Close upload dialog"><X size={21}/></button><div className="eyebrow">A LITTLE INSPIRATION STARTS HERE</div><h2 id="reel-upload-title">Upload a reel</h2><p>Save a link or a video, then choose where it belongs.</p><div className="upload-mode" role="group" aria-label="Reel upload method"><button className={mode==='link'?'selected':''} disabled={busy} onClick={()=>{setMode('link');setError('');}}><Link2 size={16}/>Paste a link</button><button className={mode==='file'?'selected':''} disabled={busy} onClick={()=>{setMode('file');setError('');}}><Upload size={16}/>Upload a video</button></div><form onSubmit={event=>{event.preventDefault();void save();}}>
  {mode==='link'?<label className="upload-field">Instagram or TikTok link<input ref={input} type="url" inputMode="url" required value={link} disabled={busy} placeholder="https://www.instagram.com/reel/…" onChange={event=>setLink(event.target.value)}/></label>:<div className={'upload-dropzone'+(dragging?' is-dragging':'')} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);if(busy)return;if(event.dataTransfer.files.length!==1){setError('Drop one video at a time.');return;}chooseFile(event.dataTransfer.files[0]);}}><Film size={32}/><strong>{file?file.name:'Choose a video or drop it here'}</strong><span>{file?(file.size<100000?Math.max(1,Math.round(file.size/1000))+' KB':(file.size/1_000_000).toFixed(1)+' MB'):'MP4, MOV or WebM · up to 50 MB · up to 3 minutes'}</span><label className="secondary upload-file-label">{file?'Choose another video':'Choose video'}<input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={busy} onChange={event=>chooseFile(event.target.files?.[0]||null)}/></label></div>}
  <label className="upload-field">Where to save it<select disabled={busy||!sources.ready||!trips.ready} value={target} onChange={event=>setTarget(event.target.value)}><option value="individual">Individual reel</option>{sources.bundles.length>0&&<optgroup label="Bundles">{sources.bundles.map(bundle=><option key={bundle.id} value={'bundle:'+bundle.id}>{bundle.name} · {bundle.reelIds.length}/12 reels</option>)}</optgroup>}{trips.trips.length>0&&<optgroup label="Buckets">{trips.trips.map(trip=><option key={trip.id} value={'trip:'+trip.id}>{trip.name}</option>)}</optgroup>}{shared.length>0&&<optgroup label="Shared buckets">{shared.map(bucket=><option key={bucket.id} value={'shared:'+bucket.id}>{bucket.name} · shared with {bucket.members}</option>)}</optgroup>}</select></label>
  <fieldset className="upload-analysis-choice"><legend>What happens next?</legend><label><input type="radio" name="upload-analysis" checked={analyse} disabled={busy} onChange={()=>setAnalyse(true)}/><span><strong>Save and analyse</strong><small>Find places and ideas in the background.</small></span></label><label><input type="radio" name="upload-analysis" checked={!analyse} disabled={busy} onChange={()=>setAnalyse(false)}/><span><strong>Save only</strong><small>Keep it for later. No analysis starts now.</small></span></label></fieldset>
  {mode==='file'&&<p className="upload-retention">Upload only content you have the right to use. The original video is private to this browser and kept for 7 days. Keep your own copy. Saved breakdowns stay on this device; server analysis is cached for 7 days after processing.</p>}
  {error&&<p className="upload-error" role="alert">{error}</p>}{stage&&<p className="upload-status" role="status">{stage} Keep this page open until the upload finishes.</p>}<button className="primary upload-submit" disabled={busy||!sources.ready||!trips.ready||(mode==='link'?!link.trim():!file&&!uploaded)}>{busy?stage||'Saving…':error?'Retry '+(analyse?'save and analyse':'save'):analyse?'Save and analyse':'Save reel'}{!busy&&<ArrowRight size={16}/>}</button>{busy&&mode==='file'&&!uploaded&&<button className="secondary" type="button" onClick={cancelUpload}>Cancel upload</button>}{!busy&&mode==='link'&&!link.trim()&&<p className="upload-hint">Paste a link to save your reel.</p>}
 </form></div></dialog>{toast&&<div className="reel-upload-toast" role="status"><CheckCircle2 size={19}/><span>{feedback}{toast.syncPending&&' Sync with the iPhone app needs another try.'}</span>{toast.syncPending&&<button type="button" onClick={retrySync}>Retry iPhone sync</button>}<a href={'/?reel='+encodeURIComponent(toast.reel.id)}>Open reel<ArrowRight size={14}/></a><button aria-label="Dismiss upload notification" onClick={()=>setToast(null)}><X size={17}/></button></div>}</>;
}
