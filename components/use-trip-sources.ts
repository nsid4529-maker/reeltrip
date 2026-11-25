'use client';
import {useEffect,useState} from 'react';
import {BUCKETS_KEY,readBuckets,type ReelBucket} from '@/lib/reel-buckets';
import {LIBRARY_KEY,readLibrary,type Reel} from '@/lib/reel-library';
export function useTripSources(){
 const [reels,setReels]=useState<Reel[]>([]),[bundles,setBundles]=useState<ReelBucket[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{
  function refresh(){try{setReels(readLibrary(localStorage.getItem(LIBRARY_KEY)));setBundles(readBuckets(localStorage.getItem(BUCKETS_KEY)));setError('');}catch{setError('Your saved sources could not be read. They have been kept unchanged.');}finally{setReady(true);}}
  function storage(e:StorageEvent){if(e.key===null||e.key===LIBRARY_KEY||e.key===BUCKETS_KEY)refresh();}
  const events=['focus','reeltrip:library-changed','reeltrip:bundles-changed','reeltrip-native-library'];
  refresh();events.forEach(event=>window.addEventListener(event,refresh));window.addEventListener('storage',storage);
  return ()=>{events.forEach(event=>window.removeEventListener(event,refresh));window.removeEventListener('storage',storage);};
 },[]);
 return {reels,bundles,error,ready};
}
