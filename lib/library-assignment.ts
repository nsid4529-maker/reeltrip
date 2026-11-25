import {loadTrips,type TripPatch} from './trip-buckets.ts';
import {LIBRARY_KEY,readLibrary,type Reel} from './reel-library.ts';
import {BUCKETS_KEY,readBuckets,type ReelBucket} from './reel-buckets.ts';

export type LibraryAssignment={kind:'reel';reel:Reel}|{kind:'bundle';bundle:ReelBucket};
export function libraryAssignment(storage:Pick<Storage,'getItem'|'setItem'>,tripId:string,source:LibraryAssignment){
 const trip=loadTrips(storage).trips.find(t=>t.id===tripId);
 if(!trip)throw new Error('That trip is no longer saved. Choose another trip.');
 const kind=source.kind,id=kind==='reel'?source.reel.id:source.bundle.id;
 const exists=kind==='reel'?readLibrary(storage.getItem(LIBRARY_KEY)).some(r=>r.id===id):readBuckets(storage.getItem(BUCKETS_KEY)).some(b=>b.id===id);
 if(!exists)throw new Error('This '+kind+' is no longer in your library. Refresh the page and try again.');
 const patch:TripPatch=kind==='reel'?{reelIds:[...new Set([...trip.reelIds,id])]}:{bundleIds:[...new Set([...trip.bundleIds,id])]};
 return {trip,patch};
}
