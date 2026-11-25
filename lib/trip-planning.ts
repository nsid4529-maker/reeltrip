import rawCatalog from './catalog.json' with {type:'json'};
import {accommodationMatches,matches} from './travel.ts';
import type {VideoAnalysis,VideoSource} from './analysis.ts';
import type {AnalysisCache} from './analysis-cache.ts';
import {reelID,type Reel} from './reel-library.ts';
import type {TripBucket} from './trip-buckets.ts';
import type {ChatPreferences} from './bundle-chat.ts';
const reviewed=(rawCatalog as VideoSource[]).map(source=>({source,matches:matches.filter(m=>m.source===source.id)}));
export function reviewedReel(reel:Reel){return reviewed.find(a=>reelID(a.source.source_url)===reel.id);}
export function tripAnalysisRows(reels:Reel[],cache:AnalysisCache){
 return [...new Map(reels.map(r=>[r.id,r])).values()].map(reel=>{
  const known=reviewedReel(reel),entry=cache[reel.id];
  let analysis:VideoAnalysis|undefined=known;
  if(!analysis&&entry?.status==='complete'&&entry.clip?.source&&Array.isArray(entry.clip.matches))analysis={source:entry.clip.source,matches:entry.clip.matches};
  return {reel,analysis,status:analysis?'complete':entry?.status||'pending',message:entry?.message||entry?.clip?.message||''};
 });
}
export function tripChatPreferences(trip:TripBucket):ChatPreferences{
 return {name:trip.name,destination:trip.destination,dates:trip.dates,activeDate:trip.activeDate,adults:trip.adults,currency:trip.currency,brief:trip.brief};
}
export function tripAccommodationRows(reels:Reel[],cache:AnalysisCache){
 return tripAnalysisRows(reels,cache).flatMap(row=>row.analysis?accommodationMatches(row.analysis.matches,[row.analysis.source.id]).map(match=>({match,source:row.analysis!.source})):[]);
}
