import {generateItinerary,type Itinerary} from './itinerary.ts';
import type {VideoAnalysis} from './analysis.ts';
import type {Match} from './travel.ts';
import type {SharedBucket,SharedPlace,SharedReel} from './shared-client.ts';

export type PlanChoice={place:SharedPlace;reel:SharedReel};
export type SharedPlan={itinerary:Itinerary|null;reason:string;kept:PlanChoice[];undecided:PlanChoice[];skipped:number;unscheduled:PlanChoice[];logistics:PlanChoice[]};
export const sharedPlaceAnchor=(id:string)=>'shared-place-'+encodeURIComponent(id);
const identity=(p:SharedPlace)=>JSON.stringify([p.title.trim().toLowerCase(),p.place.trim().toLowerCase(),p.category]);

export function generateSharedPlan(bucket:SharedBucket):SharedPlan{
 const choices=bucket.reels.flatMap(reel=>reel.places.map(place=>({place,reel})));
 const kept=choices.filter(({place:p})=>p.up>p.down&&p.up>0);
 const undecided=choices.filter(({place:p})=>p.up===p.down&&p.up>0);
 const logistics=kept.filter(({place:p})=>p.category==='Stays'||p.category==='Transport');
 const result:SharedPlan={itinerary:null,reason:'',kept,undecided,skipped:choices.filter(({place:p})=>p.down>p.up).length,unscheduled:[],logistics};
 if(!bucket.trip.start||!bucket.trip.end)return {...result,reason:'Save your trip dates to generate a day-by-day plan.'};
 if(!kept.some(({place:p})=>p.category==='Experiences'||p.category==='Food'))return {...result,reason:'Keep an activity or restaurant to start your plan. Tied votes need a group decision.'};
 const collection:VideoAnalysis[]=bucket.reels.flatMap(reel=>{
  const selected=kept.filter(c=>c.reel.id===reel.id).sort((a,b)=>(b.place.up-b.place.down)-(a.place.up-a.place.down));
  if(!selected.length)return [];
  return [{source:{id:reel.id,platform:reel.platform,source_url:reel.url,creator:reel.creator,title:reel.title||'Saved reel',scope:'Places kept by your group',analysis_kind:'ai',days:[],unknowns:[]},
   matches:selected.map(({place:p})=>({id:p.id,source:reel.id,title:p.title,place:p.place,category:p.category as Match['category'],quote:p.quote,second:p.second,kind:p.kind||'',query:p.query||p.title,providers:[],note:p.quote}))}];
 });
 try{
  // Reuse the existing conservative scheduler; empty source days cannot reintroduce skipped ideas.
  const itinerary=generateItinerary({prompt:'',selected:collection.map(a=>a.source.id),dates:[{start:bucket.trip.start,end:bucket.trip.end}],activeDate:0,adults:bucket.trip.travellers,currency:'GBP'},'auto',collection);
  for(const day of itinerary.days)for(const stop of day.stops){
   if(!stop.matchId&&stop.title==='A flexible day')stop.detail='No further kept stop fits this day. Leave it flexible, or keep more places and review the draft.';
  }
  const scheduledIds=new Set(itinerary.days.flatMap(d=>d.stops.map(s=>s.matchId).filter(Boolean)));
  const scheduledPlaces=new Set(kept.filter(c=>scheduledIds.has(c.place.id)).map(c=>identity(c.place)));
  return {...result,itinerary,unscheduled:kept.filter(c=>!logistics.includes(c)&&!scheduledPlaces.has(identity(c.place)))};
 }catch(error){return {...result,reason:error instanceof Error?error.message:'Check your trip dates before generating a plan.'};}
}
