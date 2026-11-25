import type {VideoAnalysis,VideoSource} from './analysis.ts';
import type {ChatPreferences} from './bundle-chat.ts';
import {interestKey,interestUrl,itemForMatch,type Interest} from './interested.ts';
import {choiceDates,savedChoiceHandoff} from './saved-choice-links.ts';
import {hotelSearchLinks,hotelSearchQuery,hotelProviderLinks,diningDays,searchLocationText,type Dining,type Match} from './travel.ts';
import {activityExplorerUrl} from './activity-context.ts';
import {restaurantSearchLinks} from './restaurant-links.ts';
import {providerProduct} from './provider-links-save.ts';
import {calendarDate} from './getyourguide.ts';

export type SpecialistKind='hotel'|'restaurant'|'activity';
export const specialistLabels={hotel:'Hotels',restaurant:'Restaurants',activity:'Activities'};
export const specialistPrompts=['Prepare hotel options','Prepare restaurant options','Prepare activity options'];
export type PreparationState={version:1;diningDate:string;diningTime:string;problems:Record<string,string>};
export type PreparationLink={provider:string;label:string;url:string;kind:'search'|'venue'|'saved';notice:string};
export type PreparedChoice={id:string;specialist:SpecialistKind;title:string;place:string;status:'Suggested'|'Shortlisted'|'Ready to open'|'Needs attention';shortlisted:boolean;match?:Match;source?:VideoSource;item?:Interest;links:PreparationLink[];missing:string[];problem?:string;meal?:Dining};
export const PREPARATION_CHANGED='reeltrip:preparation-changed';
export const emptyPreparation=():PreparationState=>({version:1,diningDate:'',diningTime:'',problems:{}});

export function routeSpecialistIntent(text:string):SpecialistKind[]{
 if(/\b(don['’]?t|do not|never|stop)\b/i.test(text)||!/\b(?:prepare|find|show|book|reserve)\b/i.test(text))return [];
 const result:SpecialistKind[]=[];
 if(/\b(hotels?|stays?|accommodation)\b/i.test(text))result.push('hotel');
 if(/\b(restaurants?|caf[eé]s?|dining|tables?|places to eat)\b/i.test(text))result.push('restaurant');
 if(/\b(activit(?:y|ies)|experiences?|tours?|excursions?)\b/i.test(text))result.push('activity');
 if(!result.length&&/\b(?:prepare|show)\b.*\b(?:bookings?|booking options)\b/i.test(text))return ['hotel','restaurant','activity'];
 return result;
}

export function preparationStorageKey(tripId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tripId))throw new Error('Choose a valid bucket before saving preparation notes.');
 return 'reeltrip-preparation-v1:'+tripId.toLowerCase();
}
export function readPreparation(raw:string|null):PreparationState{
 if(raw===null)return emptyPreparation();
 const failed='Your saved preparation notes could not be read. Existing data has been kept unchanged.';
 try{
  if(raw.length>250000)throw new Error(failed);
  const value=JSON.parse(raw);
  if(!value||value.version!==1||!(value.diningDate===''||calendarDate(value.diningDate))||typeof value.diningTime!=='string'||(value.diningTime!==''&&!/^([01]\d|2[0-3]):(00|30)$/.test(value.diningTime))||!value.problems||typeof value.problems!=='object'||Array.isArray(value.problems)||Object.keys(value.problems).length>300)throw new Error(failed);
  for(const [id,reason] of Object.entries(value.problems))if(!id||id.length>1024||['__proto__','constructor','prototype'].includes(id)||typeof reason!=='string'||!reason.trim()||reason.length>400||/[\u0000-\u001f]/.test(reason))throw new Error(failed);
  return {version:1,diningDate:value.diningDate,diningTime:value.diningTime,problems:{...value.problems}};
 }catch{throw new Error(failed);}
}
export function updatePreparation(storage:Pick<Storage,'getItem'|'setItem'>,tripId:string,patch:{diningDate?:string;diningTime?:string;problem?:{id:string;reason:string|null}}):PreparationState{
 const key=preparationStorageKey(tripId),state=readPreparation(storage.getItem(key));
 const next={...state,...(patch.diningDate!==undefined?{diningDate:patch.diningDate}:{}),...(patch.diningTime!==undefined?{diningTime:patch.diningTime}:{}),problems:{...state.problems}};
 if(patch.problem){if(['__proto__','constructor','prototype'].includes(patch.problem.id))throw new Error('Invalid preparation item.');if(patch.problem.reason===null)delete next.problems[patch.problem.id];else next.problems[patch.problem.id]=patch.problem.reason;}
 const raw=JSON.stringify(next),checked=readPreparation(raw);storage.setItem(key,raw);return checked;
}
export function preparationMeal(preferences:ChatPreferences,state:PreparationState):Dining|undefined{
 const dates=choiceDates(preferences);if(!dates||!state.diningTime)return;
 const days=diningDays(dates),date=days.includes(state.diningDate)?state.diningDate:dates.start;
 if(!/^([01]\d|2[0-3]):(00|30)$/.test(state.diningTime)||!Number.isInteger(preferences.adults)||preferences.adults<1||preferences.adults>8)return;
 return {date,time:state.diningTime,covers:preferences.adults};
}

export function prepareSpecialists({analyses,interests,preferences,state=emptyPreparation()}:{analyses:VideoAnalysis[];interests:Interest[];preferences:ChatPreferences;state?:PreparationState}):PreparedChoice[]{
 const categories={Stays:'hotel',Food:'restaurant',Experiences:'activity'} as const;
 const cards:PreparedChoice[]=[],used=new Set<string>();
 for(const analysis of analyses)for(const match of analysis.matches){
  if(!(match.category in categories)||match.source!==analysis.source.id)continue;
  let item:Interest|undefined;try{const key=interestKey(itemForMatch(match));item=interests.find(item=>item.id===key);}catch{}
  if(item)used.add(item.id);
  cards.push({id:'source:'+match.source+':'+match.id,specialist:categories[match.category as keyof typeof categories],title:match.title,place:match.place,shortlisted:!!item,status:'Suggested',match,source:analysis.source,item,links:[],missing:[]});
 }
 for(const item of interests)if(item.kind!=='flight'&&!used.has(item.id))cards.push({id:'saved:'+item.id,specialist:item.kind,title:item.title,place:item.place,shortlisted:true,status:'Shortlisted',item,links:[],missing:[]});
 const partyValid=Number.isInteger(preferences.adults)&&preferences.adults>=1&&preferences.adults<=8&&['GBP','EUR','USD','INR'].includes(preferences.currency);
 for(const card of cards){
  const dates=choiceDates(preferences,card.specialist==='hotel'),query=card.specialist==='hotel'&&card.match?hotelSearchQuery(card.match):card.match?.query||[card.title,card.place||preferences.destination].filter(Boolean).join(' '),place=card.place||preferences.destination;
  if(!dates)card.missing.push(card.specialist==='hotel'?'Choose valid check-in and check-out dates.':'Choose a valid activity or dining date in this bucket.');
  if(!partyValid)card.missing.push('Choose valid bucket guests and currency.');
  if(card.item&&!interestUrl(card.item.url))card.problem='This saved provider link is invalid. Edit it in Interested; the choice has been kept.';
  if(card.specialist==='hotel'&&dates&&partyValid){
   const links=card.match?hotelProviderLinks(card.match,dates,preferences.adults,preferences.currency):hotelSearchLinks(query,dates,preferences.adults,preferences.currency);
   card.links=links.map(link=>({provider:link.provider,label:link.propertyName?'Open '+link.propertyName+' on '+link.provider:'Search '+link.provider+' with bucket dates',url:link.url,kind:link.propertyName?'venue':'search',notice:link.propertyName?'Matched property page with bucket dates and guests. Confirm room availability, total price, currency and cancellation terms.':'Hotel-name search, not an exact room match. Confirm total price, room, currency and cancellation terms.'}));
  }
  if(card.specialist==='restaurant'){
   card.meal=preparationMeal(preferences,state);
   if(!card.meal)card.missing.push('Choose a local dining time below.');
   card.links=restaurantSearchLinks({query:card.match?.query||card.title,place,kind:card.match?.kind,meal:card.meal}).map(link=>({provider:link.provider,label:link.label,url:link.url,kind:link.kind==='venue'?'venue':'search',notice:link.detail}));
  }
  if(card.specialist==='activity'){
   if(!searchLocationText(place))card.missing.push('Choose a city or area before comparing activity options.');
   const handoff=card.item?savedChoiceHandoff(card.item,preferences):null;
   if(handoff?.currentUrl)card.links.push({provider:providerProduct(card.item!.url)?.provider||card.item!.provider,label:handoff.label,url:handoff.currentUrl,kind:'saved',notice:handoff.notice});
   card.links.push({provider:'Viator & GetYourGuide',label:'Compare activity options with bucket details',url:activityExplorerUrl({title:card.title,query,place},dates,preferences.adults,preferences.currency),kind:'search',notice:'Search and compare actual provider products. This does not identify the original operator or confirm availability.'});
  }
  if(card.item&&interestUrl(card.item.url))card.links.push({provider:card.item.provider,label:'Open original saved provider page',url:interestUrl(card.item.url)!,kind:'saved',notice:'The saved page may retain old details. Enter and confirm this bucket’s dates, guests and preferences on the provider.'});
  if(state.problems[card.id])card.problem='You reported: '+state.problems[card.id];
  card.status=card.problem?'Needs attention':!card.shortlisted?'Suggested':card.missing.length||!card.links.length?'Shortlisted':'Ready to open';
 }
 return cards;
}

export function specialistDestinationLinks(specialist:SpecialistKind,preferences:ChatPreferences,state=emptyPreparation()):PreparationLink[]{
 const destination=preferences.destination.trim();if(!destination)return [];
 const dates=choiceDates(preferences,specialist==='hotel');
 if(specialist==='hotel')return hotelSearchLinks(destination,dates,preferences.adults,preferences.currency).map(link=>({provider:link.provider,label:'Search '+destination+' hotels on '+link.provider,url:link.url,kind:'search',notice:dates?'Destination search with bucket dates and guests, not a suggested property. Confirm room, price and cancellation terms.':'Destination search only. Add valid check-in and check-out dates in bucket settings.'}));
 if(specialist==='restaurant')return restaurantSearchLinks({query:'Restaurants in '+destination,place:destination,meal:preparationMeal(preferences,state)}).map(link=>({provider:link.provider,label:link.label,url:link.url,kind:'search',notice:'Destination restaurant search. No venue, table or availability has been selected.'}));
 return [{provider:'Viator & GetYourGuide',label:'Explore '+destination+' activities',url:activityExplorerUrl({title:destination+' activities',query:destination,place:destination},dates,preferences.adults,preferences.currency),kind:'search',notice:'Compare provider results with the bucket’s available dates and guests. No activity or original operator has been selected.'}];
}
