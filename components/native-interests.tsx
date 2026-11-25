'use client';
import {useEffect,useState} from 'react';
import {INTERESTS_CHANGED,importNativeInterests} from '@/lib/interested';
import {nativeLibrary,nativeLibraryError,type NativeLibraryEvent} from '@/lib/native-library';

export function NativeInterests(){
 const [notice,setNotice]=useState<{message:string;retry:boolean}|null>(null);
 useEffect(()=>{
  function receive(event:Event){
   const detail=(event as NativeLibraryEvent).detail;
   const error=nativeLibraryError(detail);
   if(error){setNotice({message:error+' Pending shares have been kept. Retry the import when ready.',retry:true});return;}
   if(!detail||detail.pendingInterests===undefined)return;
   try {
    const result=importNativeInterests(window.localStorage,detail.pendingInterests);
    if(result.acknowledged.length){
     window.dispatchEvent(new Event(INTERESTS_CHANGED));
     // A failed bridge send leaves durable receipts for the next replay.
     try{nativeLibrary({action:'acknowledgeInterests',ids:result.acknowledged});}catch{/* Retry on next native library event. */}
    }
    const messages:string[]=[];
    if(result.added)messages.push(result.added===1?'Shared place saved to Interested.':result.added+' shared places saved to Interested.');
    if(result.pending)messages.push('Your Interested list is full. Remove a place, then retry; the remaining shares are still saved in the app.');
    if(result.rejected)messages.push('Some shared links could not be imported. Open the full activity, hotel or restaurant page and share its link again.');
    if(messages.length)setNotice({message:messages.join(' '),retry:result.pending>0||result.rejected>0});
   }catch{
    setNotice({message:'Your shared places could not be saved to Interested on this device. Existing items and pending shares have been kept. Check browser storage, then retry.',retry:true});
   }
  }
  function request(){try{nativeLibrary({action:'library'});}catch{/* The next foreground event can retry. */}}
  function visible(){if(document.visibilityState==='visible')request();}
  window.addEventListener('reeltrip-native-library',receive);
  window.addEventListener('focus',request);document.addEventListener('visibilitychange',visible);
  // Install the listener before requesting: native responses can be immediate.
  request();
  return ()=>{window.removeEventListener('reeltrip-native-library',receive);window.removeEventListener('focus',request);document.removeEventListener('visibilitychange',visible);};
 },[]);
 if(!notice)return null;
 return <aside className="native-interest-notice" aria-label="Shared places"><p role="status">{notice.message}</p><div className="native-interest-actions"><a href="/interested">View Interested</a>{notice.retry&&<button type="button" onClick={()=>{try{nativeLibrary({action:'library'});}catch{}}}>Retry import</button>}<button type="button" onClick={()=>setNotice(null)} aria-label="Dismiss shared places notice">Dismiss</button></div></aside>;
}
