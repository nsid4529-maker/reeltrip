import {searchLocationText,validateDates,type Match,type Window} from './travel.ts';

export type ActivityContext={destination:string;query:string;title:string;start:string;end:string;adults:number;currency:string};
const text=(value:string|null,limit=200)=>(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,limit);
const words=(value:string)=>' '+text(value).toLocaleLowerCase('en-GB').replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';

// Keep real source place names intact. These are choices, not geocoded coverage
// or proof that an operator visits the place.
export function activityLocations(matches:Pick<Match,'place'>[],destination=''):string[]{
 const seen=new Set<string>();
 return [destination,...matches.map(match=>match.place)].flatMap(value=>{
  const place=searchLocationText(text(value)),key=place.toLocaleLowerCase('en-GB');
  if(!place||seen.has(key))return [];
  seen.add(key);return [place];
 }).slice(0,60);
}
export function activitySearchQuery(query:string,location:string):string{
 const place=text(location),search=text(query);
 if(!place)return search;
 if(!search||search.toLocaleLowerCase('en-GB')===place.toLocaleLowerCase('en-GB'))return place;
 // Put the selected location first and retain the user's activity terms.
 return words(search).includes(words(place))?search:`${place} ${search}`.slice(0,200);
}
// Search edits are not edits to reel evidence. On changing the location, clear
// a source-specific recommendation or terms naming the old location rather
// than silently turn it into a contradictory multi-city search.
export function activityTermsAfterLocationChange(query:string,previous:string,next:string,sourceSpecific=false):string{
 if(!text(previous)||words(previous)===words(next))return query;
 return sourceSpecific||(text(previous)&&words(query).includes(words(previous)))?'':query;
}

// The URL carries search preferences, not trusted source evidence or provider inventory.
export function readActivityContext(params:URLSearchParams):ActivityContext{
 const destination=searchLocationText(text(params.get('destination')));
 const query=text(params.get('q'))||destination;
 const adults=Number(params.get('adults')||2);
 let start=params.get('start')||'',end=params.get('end')||start;
 try{validateDates([{start,end}],undefined,true);}catch{start='';end='';}
 return {destination,query,title:text(params.get('title')),start,end,
  adults:Number.isInteger(adults)&&adults>=1&&adults<=8?adults:2,
  currency:['GBP','EUR','USD','INR'].includes(params.get('currency')||'')?params.get('currency')!:'GBP'};
}

export function activityExplorerUrl(match:Pick<Match,'title'|'query'|'place'>,dates?:Window,adults=2,currency='GBP'){
 const raw=new URLSearchParams({destination:match.place,q:match.query,title:match.title,adults:String(adults),currency});
 if(dates){raw.set('start',dates.start);raw.set('end',dates.end);}
 const c=readActivityContext(raw);
 const params=new URLSearchParams({destination:c.destination,q:c.query,title:c.title,adults:String(c.adults),currency:c.currency});
 if(c.start){params.set('start',c.start);params.set('end',c.end);}
 return '/activities?'+params;
}
