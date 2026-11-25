import {diningDays,rankedMatches,validateDates,type Trip} from './travel.ts';
import type {VideoAnalysis} from './analysis.ts';
export type Base = 'auto'|'ella'|'sigiriya'|'coast';
export type Stop = {period:string;title:string;detail:string;source?:string;second?:number;matchId?:string;alsoSources?:{source:string;second:number}[]};
export type Day = {date:string;title:string;stops:Stop[]};
export type Itinerary = {signature:string;base:string;region:Exclude<Base,'auto'>|'custom';nights:number;days:Day[];stayId:string;includedSources:string[];otherSources:string[];warnings:string[];createdAt:string};
const regions={ella:{name:'Ella',sources:['ella','kanisha'],stay:'ella-stay'},sigiriya:{name:'Sigiriya',sources:['sigiriya','kanisha'],stay:'roys'},coast:{name:'Ahangama & the south coast',sources:['shreya'],stay:'coast'}};
export function itinerarySignature(trip:Trip,base:Base,analysis?:VideoAnalysis|VideoAnalysis[]){return JSON.stringify({version:2,selected:[...trip.selected].sort(),dates:trip.dates[trip.activeDate],prompt:trip.prompt,adults:trip.adults,base,analysis:analysis?(Array.isArray(analysis)?analysis:[analysis]).map(a=>({source:a.source.id,days:a.source.days,matches:a.matches.map(m=>[m.id,m.title,m.second])})):undefined});}
const stop=(period:string,title:string,detail:string,source?:string,second?:number,matchId?:string):Stop=>({period,title,detail,source,second,matchId});
function programmes(region:Exclude<Base,'auto'>,selected:string[]):Stop[][]{
 if(region==='ella'&&selected.includes('ella'))return [
  [stop('Morning','Ravana Falls & a waterfall outing','The creator used a local tuk-tuk driver. Confirm the route and safe access; two other waterfalls were not identified.','ella',0,'waterfalls'),stop('Afternoon','Nine Arch Bridge','Use designated visitor access and keep off active railway tracks. Local travel time is not verified.','ella',20.72,'bridge'),stop('Evening','Sunset drinks at Café Soul','A named stop overlooking the bridge. Check opening hours directly; an OpenTable match is not confirmed.','ella',20.72,'cafe-soul')],
  [stop('Morning',"Little Adam’s Peak","A hike named in the reel; check your fitness, weather and access before setting out.",'ella',26.32),stop('Afternoon','Ravana Pool Club','The creator combined this with the hike. Confirm current entry, bed reservations and opening hours.','ella',26.32,'pool'),stop('Evening','An unhurried evening in Ella','Keep dinner flexible. The restaurant in the video was unnamed.','ella',43.04)]
 ];
 if(region==='ella')return [[stop('Morning','Nine Arch Bridge','Named in the selected guided-tour reel. Choose your own transport after checking local timings.','kanisha',42.8),stop('Afternoon','Rest or an optional hill-country outing','Little Adam’s Peak and Ravana Falls were listed in the tour, but the creator did not do them because of an injury. Treat them as optional and assess suitability.','kanisha',46),stop('Evening','Dinner near your accommodation','The reel does not identify a restaurant. Choose locally after checking opening hours.')]];
 if(region==='sigiriya'&&selected.includes('sigiriya'))return [
  [stop('Morning','Village cycling','Ask your accommodation about a guided route and current inclusions. Leave time to return before a safari.','sigiriya',16.72),stop('Afternoon','Minneriya National Park safari','The creator described a 4–5 hour outing. Confirm pickup, park conditions and the exact duration; wildlife sightings are not guaranteed.','sigiriya',25.12,'safari'),stop('Evening','Dinner at your base','The creator joined a family-style dinner and quiz at the hostel. Ask whether these are running during your stay.','sigiriya',35.68)],
  [stop('Early morning','Pidurangala sunrise hike','The creator woke at 04:30. Set your own departure after checking sunrise, transfer and trail conditions.','sigiriya',39.52,'sunrise'),stop('Afternoon','Rest at your accommodation','Keep recovery time after the early start.','sigiriya',52.8),stop('Evening','Cooking class & a Sri Lankan meal','A cooking class was included during the creator’s stay. Confirm the current programme and charges; it is not guaranteed to be free.','sigiriya',10.4)]
 ];
 if(region==='sigiriya')return [[stop('Morning','Village experience near Sigiriya','The reel shows a village visit with boat and cart rides. The exact operator is unnamed; ask about inclusions and suitability.','kanisha',12.1),stop('Afternoon','Local Sri Lankan food','Food was part of the village experience. The restaurant and current menu were not identified.','kanisha',12.1),stop('Evening','Settle into your Sigiriya base','This is a planning suggestion. The reel continued to Kandy; this relaxed plan does not reproduce that compressed route.')]];
 return [
  [stop('Morning','Breakfast at Paradise Cove','A named food stop in Midigama. Confirm reservations and opening hours with the venue.','shreya',28.24,'paradise-breakfast'),stop('Afternoon','A slow beach afternoon','The creator spent time on beach beds at Paradise Cove. Check current day-bed prices and availability.','shreya',28.24,'beach'),stop('Evening','Return to your south-coast base','Leave travel time from Midigama and arrange dinner locally. Transfer schedules are not established.')],
  [stop('Morning','Explore Galle’s lanes','Plan local transport from your base and allow enough time to return.','shreya',48.88,'galle'),stop('Afternoon','Cafés, boutiques & gelato','The gelato shop is unnamed. OpenTable searches are alternatives, not identification of the original venue.','shreya',48.88,'galle-cafes'),stop('Evening','Evening lights in Galle','Stay for an unhurried evening if return transport allows.','shreya',48.88)],
  [stop('Morning','Optional spa or massage','The creator mentioned a spa, but its identity is unresolved. Choose a local provider yourself; no business is substituted.','shreya',65.2),stop('Afternoon','Kai Boutique & Cactus','Both shops are named in narration. Check locations and hours before going.','shreya',71.04),stop('Evening','A relaxed evening at the villa','One of the creator’s suggested alternatives. No party or music schedule is assumed.','shreya',59.32)]
 ];
}
export function generateItinerary(trip:Trip,base:Base='auto',analysis?:VideoAnalysis|VideoAnalysis[]):Itinerary{
 if(analysis)return generateVideoItinerary(trip,analysis);
 const dates=trip.dates[trip.activeDate];validateDates([dates]);
 const supported=Object.entries(regions).filter(([,r])=>r.sources.some(s=>trip.selected.includes(s))).map(([key])=>key as Exclude<Base,'auto'>);
 if(!supported.length)throw new Error('Select at least one reviewed video before generating an itinerary.');
 if(base!=='auto'&&!supported.includes(base))throw new Error('Select a video covering this base, or choose Best fit for my videos.');
 const ranked=rankedMatches(trip.selected,trip.prompt);
 const score=(key:Exclude<Base,'auto'>)=>{const r=regions[key];return ranked.reduce((n,m,i)=>n+(r.sources.includes(m.source)&&((key==='ella'&&m.place==='Ella')||(key==='sigiriya'&&m.place==='Sigiriya')||(key==='coast'&&m.source==='shreya'))?(ranked.length-i):0),0)+((key==='ella'&&/ella|waterfall|train/i.test(trip.prompt))||(key==='sigiriya'&&/sigiriya|safari|elephant/i.test(trip.prompt))||(key==='coast'&&/coast|beach|galle|ahangama/i.test(trip.prompt))?100:0);};
 const region=base==='auto'?[...supported].sort((a,b)=>score(b)-score(a))[0]:base;
 const info=regions[region],days=diningDays(dates),patterns=programmes(region,trip.selected),included=trip.selected.filter(s=>info.sources.includes(s));
 const output:Day[]=days.map((date,i)=>{
  let activities:Stop[];
  if(i===0)activities=[stop('Arrival','Travel to '+info.name,'Your starting point and arrival time are not provided. Arrange a transfer and leave this day flexible; this is not a timed transport booking.'),stop('Afternoon','Check in & settle in','Confirm check-in with your accommodation. Keep the first afternoon light.'),stop('Evening','Dinner close to your stay','Choose somewhere nearby after arrival. No restaurant or table has been booked.')];
  else if(i===days.length-1)activities=[stop('Morning','Breakfast & pack','Keep the morning flexible around your onward journey.'),stop('Departure','Check out & onward travel','Departure location, flight/train times and transfer duration are unknown. Confirm them before adding an activity.'),stop('Evening','Onward arrangements','Dinner and accommodation after departure are outside this date window.')];
  else activities=patterns[i-1]||[stop('Morning','Free morning in '+info.name,'No additional distinct activity is supported by the selected videos. Rest, revisit a favourite or add another reviewed source.'),stop('Afternoon','Your choice of local plans','Open time, intentionally left without an invented venue or activity.'),stop('Evening','A relaxed local evening','Confirm any restaurant or event directly before going.')];
  if(i>0&&i<days.length-1){activities=[stop('Breakfast',region==='coast'&&i===1?'Keep breakfast for Paradise Cove':'Breakfast near your stay',region==='coast'&&i===1?'The morning stop includes breakfast.':'Meal planning suggestion; check your accommodation’s inclusions.'),activities[0],stop('Lunch','Lunch near today’s activities','Restaurant, menu, dietary suitability and current prices are unverified. Leave time for lunch and local travel.'),activities[1],activities[2],stop('Dinner','Confirm tonight’s dinner','Use the food recommendations where relevant, or choose a local venue. Check dietary requirements, opening hours and table availability.')];}
  return {date,title:i===0?'Arrive & settle in':i===days.length-1?'Departure day':i-1<patterns.length?'Explore '+info.name:'A flexible day',stops:activities};
 });
 const warnings=['This is a suggested itinerary, not confirmed bookings. Sequence and meal breaks are planning suggestions; source timestamps identify video evidence.','Arrival/departure logistics, local transport times, opening hours, current prices and availability still need checking.','The brief helps choose a base. Budget, dietary, accessibility and other free-text requirements must be reviewed manually.'];
 if(supported.length>1)warnings.push('Selected videos cover several regions. This draft uses one base to avoid squeezing distant stops into a short trip. Other regional ideas remain in the breakdown and shortlist.');
 if(included.includes('kanisha'))warnings.push('The guided-tour reel compresses several regions into three days. This draft uses only its relevant local evidence; the Nanu Oya–Ella train and long transfers need a separately timed route.');
 if(days.length-2<patterns.length)warnings.push('There are more source ideas than full sightseeing days. Arrival and departure are protected; remaining ideas stay in the source breakdown.');
 if(days.length-2>patterns.length)warnings.push('Some days are intentionally flexible because the videos do not supply enough distinct activities for this trip length.');
 return {signature:itinerarySignature(trip,base),base:info.name,region,nights:days.length-1,days:output,stayId:info.stay,includedSources:included,otherSources:trip.selected.filter(s=>!included.includes(s)),warnings,createdAt:new Date().toISOString()};
}

// A new reel can cover anywhere. Allocate its evidenced ideas conservatively;
// never borrow Sri Lanka templates or present model output as a verified route.
function generateVideoItinerary(trip:Trip,analysis:VideoAnalysis|VideoAnalysis[]):Itinerary{
 const collection=Array.isArray(analysis)?analysis:[analysis];
 if(!collection.length||collection.some(a=>!trip.selected.includes(a.source.id)))throw new Error('Review every selected reel’s breakdown before generating its itinerary.');
 const source=collection[0].source,matches=collection.flatMap(a=>a.matches),sourceIDs=collection.map(a=>a.source.id);
 if(trip.selected.some(id=>!sourceIDs.includes(id)))throw new Error('All selected reels need completed analysis before generating a combined itinerary.');
 const dates=trip.dates[trip.activeDate];validateDates([dates]);
 const days=diningDays(dates),ideas=matches.filter(m=>sourceIDs.includes(m.source)&&m.category!=='Stays'&&m.category!=='Transport');
 const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 const schedule=(text:string)=>weekdays.filter(d=>new RegExp('\\b'+d+'s?\\b','i').test(text));
 type Idea={title:string;detail:string;second:number;matchId?:string;source:string;category:string;weekdays:string[];closed:boolean;alsoSources:{source:string;second:number}[]};
 const evidenced:Idea[]=[],seen=new Map<string,Idea>();
 for(const m of ideas){
  // Only merge the exact same named place/category within the same location.
  // Similar names or different destinations remain separate recommendations.
  const identity=JSON.stringify([m.title.trim().toLowerCase(),m.place.trim().toLowerCase(),m.category,schedule(m.quote+' '+m.note)]);
  const existing=seen.get(identity);
  if(existing){if(existing.source!==m.source&&!existing.alsoSources.some(e=>e.source===m.source))existing.alsoSources.push({source:m.source,second:m.second});continue;}
  const idea={title:m.title,detail:m.note||m.quote,second:m.second,matchId:m.id,source:m.source,category:m.category,weekdays:schedule(m.quote+' '+(m.note||'')),closed:/\bclosed\b|\bmaintenance\b/i.test(m.quote+' '+(m.note||'')),alsoSources:[]};seen.set(identity,idea);evidenced.push(idea);
 }
 if(!evidenced.length)for(const a of collection)for(const d of a.source.days)for(const i of d.items)evidenced.push({title:i.details,detail:'An idea identified in the video. Confirm its location and suitability before planning a visit.',second:i.time_seconds[0],source:a.source.id,category:'Experiences',weekdays:schedule(i.details),closed:/\bclosed\b|\bmaintenance\b/i.test(i.details),alsoSources:[]});
 const periods=['Early morning','Breakfast','Morning','Lunch','Afternoon','Evening','Dinner','Night'];
 const slotOptions=(idea:Idea):string[]=>{
  // Only explicit words in this recommendation's title determine a fixed time.
  // A quote mentioning another stop's sunset must not move this activity there.
  const title=idea.title.toLowerCase();
  if(/\bsunrise\b|\bdawn\b/.test(title))return ['Early morning'];
  if(/\bbreakfast\b/.test(title))return ['Breakfast'];
  if(/\blunch\b|\bbrunch\b/.test(title))return ['Lunch'];
  if(/\bsunset\b|\bdusk\b/.test(title))return ['Evening'];
  if(/\bdinner\b|\bsupper\b/.test(title))return ['Dinner'];
  if(/\bnight\b|\bnightlife\b|\bparty\b|\bparties\b/.test(title+' '+idea.detail.toLowerCase()))return ['Night'];
  if(/\bevening\b/.test(title))return ['Evening'];
  if(/\bmorning\b/.test(title))return ['Morning'];
  if(/\bafternoon\b/.test(title))return ['Afternoon'];
  return idea.category==='Food'?['Lunch','Dinner']:['Morning','Afternoon'];
 };
 const allocate=(ideas:Idea[]):{idea:Idea;period:string}[]|null=>{
  const assigned=new Map<Idea,string>(),used=new Set<string>();
  for(const idea of ideas.filter(v=>slotOptions(v).length===1)){
   const period=slotOptions(idea)[0];if(used.has(period))return null;assigned.set(idea,period);used.add(period);
  }
  for(const idea of ideas.filter(v=>slotOptions(v).length>1)){
   const period=slotOptions(idea).find(p=>!used.has(p)&&!(p==='Morning'&&used.has('Early morning')));
   if(!period)return null;assigned.set(idea,period);used.add(period);
  }
  return ideas.map(idea=>({idea,period:assigned.get(idea)!})).sort((a,b)=>periods.indexOf(a.period)-periods.indexOf(b.period));
 };
 // Give each source a full day before returning to an earlier source. This
 // prevents a large first reel from consuming every available sightseeing day.
 const groups=sourceIDs.map(id=>evidenced.filter(idea=>idea.source===id)).filter(group=>group.length);
 const scheduled:{idea:Idea;period:string}[][]=[],usedIdeas=new Set<Idea>();
 let cursor=0;
 for(let day=0;day<Math.max(0,days.length-2);day++){
  const weekday=weekdays[new Date(days[day+1]+'T12:00:00Z').getUTCDay()];
  const eligible=(idea:Idea)=>!usedIdeas.has(idea)&&!idea.closed&&(!idea.weekdays.length||idea.weekdays.includes(weekday));
  let group:Idea[]|undefined;
  for(let attempt=0;attempt<groups.length;attempt++){
   const next=groups[cursor%groups.length];cursor++;
   if(next.some(eligible)){group=next;break;}
  }
  const chosen:Idea[]=[];
  for(const idea of group||[]){
   if(!eligible(idea)||chosen.length===2)continue;
   if(allocate([...chosen,idea]))chosen.push(idea);
  }
  chosen.forEach(idea=>usedIdeas.add(idea));scheduled.push(allocate(chosen)||[]);
 }
 const output:Day[]=days.map((date,i)=>{
  if(i===0)return {date,title:'Arrive & settle in',stops:[stop('Arrival','Travel & check in','Arrival location, time and accommodation are not established. Leave this day open while arranging your journey.'),stop('Evening','Dinner near your stay','Choose a convenient venue after arrival. No table has been reserved.')]};
  if(i===days.length-1)return {date,title:'Departure day',stops:[stop('Morning','Breakfast & pack','Allow time for check-out and your onward journey.'),stop('Departure','Onward travel','Confirm your departure time and transfer before adding activities.')]};
  const planned=scheduled[i-1];
  const activities:Stop[]=planned.map(({idea,period})=>({...stop(period,idea.title,idea.detail+' Suggested day allocation; verify travel distance and opening hours.',idea.source,idea.second,idea.matchId),alsoSources:idea.alsoSources}));
  if(!activities.length)activities.push(stop('Afternoon','A flexible day','The reel does not provide another distinct activity for this day. Rest or choose your own plans.'));
  if(!activities.some(s=>s.period==='Lunch'))activities.push(stop('Lunch','Lunch & time to travel','Choose a nearby lunch stop after confirming the locations of your activities. Travel times and meal arrangements are unverified.'));
  if(!activities.some(s=>s.period==='Dinner'))activities.push(stop('Dinner','Dinner near today’s plans','Choose somewhere convenient after checking the locations in your breakdown. Confirm dietary needs and reservations directly.'));
  activities.sort((a,b)=>periods.indexOf(a.period)-periods.indexOf(b.period));
  return {date,title:planned.length?'Ideas from '+(collection.find(a=>a.source.id===planned[0].idea.source)?.source.title||'your reel'):'A flexible day',stops:activities};
 });
 const areas=new Set(matches.filter(m=>m.category!=='Transport').map(m=>m.place.trim().toLowerCase()));
 const stay=collection.length===1&&areas.size===1?matches.find(m=>m.category==='Stays'&&!/unknown|unconfirmed|confirm|arrival|stopover/i.test(m.place+' '+m.note)):undefined;
 const covered=new Set([...usedIdeas].flatMap(idea=>[idea.source,...idea.alsoSources.map(e=>e.source)]));
 if(stay)covered.add(stay.source);
 const includedSources=sourceIDs.filter(id=>covered.has(id)),otherSources=sourceIDs.filter(id=>!covered.has(id));
 const omitted=evidenced.filter(idea=>!usedIdeas.has(idea));
 const warnings=[collection.some(a=>a.source.analysis_kind==='ai')?'This draft includes AI video analysis. Confirm place names against the original reels. Nothing is booked.':'This draft combines reviewed video evidence. Nothing is booked.','Days are planning suggestions. Clear sunrise, breakfast, sunset and dinner cues are retained; other meal and activity slots are suggested, not a claim about the creator’s schedule.','Locations, distances and transfer times are not verified. If the reel covers different regions, reorganise these ideas before booking travel.','The brief, budget, accessibility and dietary requirements need your review. Opening hours, prices and any selected availability can change.'];
 if(collection.length>1)warnings.push('This collection combines '+collection.length+' reels. The order is a planning suggestion; verify that all locations fit your destination and travel time. Similar recommendations from different creators retain their own attribution.');
 if(omitted.length)warnings.push('Ideas not scheduled in this date window: '+omitted.map(idea=>idea.title+' (@'+(collection.find(a=>a.source.id===idea.source)?.source.creator||idea.source)+')').join('; ')+'. They remain in the breakdown. Arrival and departure days are protected.');
 if(evidenced.some(i=>i.weekdays.length||i.closed))warnings.push('Weekday recommendations follow the creator’s stated schedule. Closed or maintenance mentions are excluded. Confirm current events directly; these are not live opening hours.');
 if(collection.length>1)warnings.push('This collection may span multiple destinations. Accommodation and transfers must be planned for each area; no single hotel base is assumed.');
 if(otherSources.length)warnings.push('No stop from these reels fits the available full days: '+otherSources.map(id=>collection.find(a=>a.source.id===id)?.source.title||id).join('; ')+'. Add more nights or choose which reels to prioritise.');
 return {signature:itinerarySignature(trip,'auto',analysis),base:collection.length===1?source.title:'Your reel collection',region:'custom',nights:days.length-1,days:output,stayId:stay?.id||'',includedSources,otherSources,warnings,createdAt:new Date().toISOString()};
}

export function itineraryMealTime(period:string,evening:string){return ['Early morning','Breakfast','Morning'].includes(period)?'09:00':['Lunch','Afternoon'].includes(period)?'13:00':evening;}
