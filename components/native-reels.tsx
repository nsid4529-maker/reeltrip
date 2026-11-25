'use client';
import {useEffect,useState} from 'react';
import {useReelAnalysis} from '@/components/use-reel-analysis';
import {nativeLibrary,nativeLibraryError,type NativeLibraryEvent,type NativeShare} from '@/lib/native-library';
import {applySharedShares,bundleCatalog,finishNativeAnalysis,importNativeShares,NATIVE_REELS_IMPORTED,pendingNativeAnalyses} from '@/lib/native-share';
import {addSharedReel,listShared,me} from '@/lib/shared-client';
import {track} from '@/lib/track';
import {writableBundles,writableLibrary} from '@/lib/reel-import';
import type {Reel} from '@/lib/reel-library';

// One importer stays mounted across every route. Home only responds to the
// committed result when a share should open its foreground analysis screen.
export function NativeReels(){
 const background=useReelAnalysis(),[notice,setNotice]=useState('');
 useEffect(()=>{
  let nativeReady=false,applying=false,alive=true,sharedRunning=false;
  // Tell the Share Extension which shared buckets this app has joined, and add
  // reels the extension queued for one. Only this web view has the member cookie.
  async function syncShared(actions:NativeShare[]|undefined){
   if(sharedRunning||!(window as Window&{webkit?:{messageHandlers?:{reeltripLibrary?:unknown}}}).webkit?.messageHandlers?.reeltripLibrary)return;sharedRunning=true;
   try{
    const member=await me();
    const buckets=member?(await listShared()).map(b=>({id:b.id,name:b.name})):[];
    nativeLibrary({action:'sharedBuckets',buckets});
    const pending=(actions||[]).filter(a=>a?.sharedBucketId);
    if(!pending.length)return;
    if(!member){if(alive)setNotice('To add the reels you shared to your group, open your invite link in this app (Shared → paste the link).');return;}
    const result=await applySharedShares(pending,buckets,async(id,url)=>{const r=await addSharedReel(id,url);if(r.added)track('reel_added',{source:'share',platform:/tiktok\.com/i.test(url)?'TikTok':'Instagram',destination:'trip',analyse:true},id);return r;});
    if(result.acknowledged.length)nativeLibrary({action:'acknowledge',ids:result.acknowledged});
    if(alive&&result.messages[0])setNotice(result.messages[0]);
   }catch{/* Offline or signed out: the shares stay queued for the next open. */}
   finally{sharedRunning=false;}
  }
  function resume(reels:Reel[]){
   for(const request of pendingNativeAnalyses(localStorage,reels)){
    if(request.seedJob)background.seedJobs({[request.reel.id]:request.seedJob});
    void background.ensure(request.reel,request.retry).catch(()=>{}).finally(()=>{if(alive)try{finishNativeAnalysis(localStorage,request.reel.id,request.actionId);}catch{/* The saved generation prevents a replay from retrying this attempt. */}});
   }
  }
  function syncBundles(){
   if(!nativeReady||applying)return;
   try{nativeLibrary({action:'bundles',bundles:bundleCatalog(writableBundles(localStorage),writableLibrary(localStorage))});}
   catch{setNotice('Your reels are saved here. Sync with the iPhone app needs another try.');}
  }
  function receive(event:Event){
   if(applying)return;
   const data=(event as NativeLibraryEvent).detail,error=nativeLibraryError(data);
   if(error){setNotice(error);return;}if(!Array.isArray(data?.videos))return;
   applying=true;
   try{
    const applied=importNativeShares(localStorage,{videos:data.videos,bundles:data.bundles,pendingShares:data.pendingShares},(jobs,reels)=>{background.restore(reels);background.seedJobs(jobs);});
    nativeReady=true;
    let syncFailed=false;
    // Keep native actions replayable until browser persistence and native
    // bundle membership are committed. Lost acknowledgements are harmless.
    try{nativeLibrary({action:'bundles',bundles:bundleCatalog(applied.buckets,applied.library)});nativeLibrary({action:'acknowledge',ids:applied.acknowledged});}
    catch{syncFailed=true;}
    window.dispatchEvent(new Event('reeltrip:library-changed'));window.dispatchEvent(new Event('reeltrip:bundles-changed'));
    resume(applied.library);
    window.dispatchEvent(new CustomEvent(NATIVE_REELS_IMPORTED,{detail:applied}));
    setNotice(syncFailed?'Your reels are saved here. Sync with the iPhone app needs another try.':applied.messages[0]||'');
    void syncShared(data.pendingShares);
   }catch{setNotice('Your shared reels are still saved in the iPhone app. Check device storage, then retry the import.');}
   finally{applying=false;}
  }
  function request(syncLocal=false){
   try{
    const reels=writableLibrary(localStorage);background.restore(reels);
    if(syncLocal){const shared=reels.filter(reel=>reel.platform!=='Uploaded video');for(let i=0;i<shared.length;i+=4)nativeLibrary({action:'save',urls:shared.slice(i,i+4).map(reel=>reel.url)});}
    nativeLibrary({action:'library'});
   }catch{setNotice('Your saved reels have been kept. Reopen ReelTrip or retry the import when the connection and device storage are ready.');}
   // Phone sync is optional for an already accepted job. Read again because a
   // native response may have imported additional reels during the request.
   try{const reels=writableLibrary(localStorage);background.restore(reels);resume(reels);}
   catch{setNotice('A saved analysis could not be resumed safely. Open its reel to retry.');}
  }
  const focus=()=>request(),visible=()=>{if(document.visibilityState==='visible')request();},retry=()=>request(true);
  window.addEventListener('reeltrip-native-library',receive);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visible);
  window.addEventListener('reeltrip:bundles-changed',syncBundles);window.addEventListener('reeltrip:retry-native-reels',retry);
  request(true);
  return()=>{alive=false;window.removeEventListener('reeltrip-native-library',receive);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visible);window.removeEventListener('reeltrip:bundles-changed',syncBundles);window.removeEventListener('reeltrip:retry-native-reels',retry);};
 },[background.restore,background.seedJobs,background.ensure]);
 if(!notice)return null;
 return <aside className="native-interest-notice" aria-label="Shared reels"><p role="status">{notice}</p><div className="native-interest-actions"><a href="/">Open Reel Library</a><button type="button" onClick={()=>window.dispatchEvent(new Event('reeltrip:retry-native-reels'))}>Retry sync</button><button type="button" onClick={()=>setNotice('')} aria-label="Dismiss shared reels notice">Dismiss</button></div></aside>;
}
