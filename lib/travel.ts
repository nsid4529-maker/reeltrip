import {getYourGuideSearchUrl} from './booking-pages.ts';
import {calendarDay} from './calendar-day.ts';
import extraMatches from './reviewed-extra-matches.json' with {type:'json'};
export type Window = { start: string; end: string };
export type Trip = { prompt: string; selected: string[]; dates: Window[]; activeDate: number; adults: number; currency: string; diningDate?: string; diningTime?: string; diners?: number };
export type Match = { id: string; title: string; place: string; category: 'Stays'|'Experiences'|'Transport'|'Food'; source: string; second: number; quote: string; kind: string; query: string; providers: string[]; direct?: string; diningMetroId?: string; note?: string };
export const matches: Match[] = [
 { id:'cafe-soul',title:'Sunset drinks at Café Soul',place:'Ella',category:'Food',source:'ella',second:20.72,quote:'Sunset drinks at Café Soul overlooking Nine Arch Bridge; later restaurant in Ella unnamed.',kind:'Café named in video',query:'Café Soul Ella Sri Lanka',providers:['OpenTable'],diningMetroId:'3401',note:'The café is named in the video. No matching OpenTable listing was found during setup; this search does not confirm participation or tables.'},
 { id:'paradise-breakfast',title:'Breakfast at Paradise Cove',place:'Midigama',category:'Food',source:'shreya',second:28.24,quote:'Slow breakfast and beach beds at Paradise Cove; food and beach time.',kind:'Venue named in video',query:'Paradise Cove Midigama Sri Lanka',providers:['OpenTable','Official website'],diningMetroId:'3401',direct:'https://paradisecovemidigama.com/',note:'OpenTable participation is unverified. If no match appears, contact the venue directly about breakfast and reservations.'},
 { id:'galle-cafes',title:'Cafés & gelato in Galle',place:'Galle',category:'Food',source:'shreya',second:48.88,quote:'Galle lanes, cafés, boutiques, evening lights and gelato; gelato shop unnamed.',kind:'Area search · venue unnamed',query:'Galle Sri Lanka restaurants cafes',providers:['OpenTable'],diningMetroId:'3401',note:'The creator did not name the café or gelato shop. Search for alternatives in Galle; results are not the original venue and coverage may be limited.'},
 { id:'ella-stay',title:'A base in Ella',place:'Ella',category:'Stays',source:'ella',second:0,quote:'Accommodation not named.',kind:'Suggested stay search',query:'Ella Sri Lanka',providers:['Booking.com'],note:'The creator did not name a hotel. These are alternatives in the same area.'},
 { id:'waterfalls',title:'Waterfalls by tuk-tuk',place:'Ella',category:'Experiences',source:'ella',second:0,quote:'Three-waterfall tour arranged informally with a tuk-tuk driver. Ravana Falls is named; the other two waterfalls are not.',kind:'Comparable experience',query:'Ella Ravana waterfalls tuk tuk tour',providers:['Viator','GetYourGuide'],note:'The original driver is unknown. Compare itineraries before booking.'},
 { id:'bridge',title:'Nine Arch Bridge',place:'Ella',category:'Experiences',source:'ella',second:20.72,quote:'Nine Arch Bridge, sunset drinks at Café Soul overlooking the bridge.',kind:'Place named in video',query:'Ella Nine Arch Bridge tour',providers:['Viator','GetYourGuide'],note:'A guided tour is an optional addition; the video does not establish that one is needed.'},
 { id:'pool',title:'Ravana Pool Club',place:'Ella',category:'Experiences',source:'ella',second:26.32,quote:"Little Adam’s Peak hike followed by Ravana Pool Club. Creator bought entry without reserving a bed.",kind:'Named venue',query:'Ravana Pool Club Ella',providers:['Official website'],direct:'https://www.ravanapoolclub.com/',note:'Historical prices in the reel are not a current quote.'},
 { id:'roys',title:"Roy’s Villa",place:'Sigiriya',category:'Stays',source:'sigiriya',second:2.88,quote:"Roy's Villa; creator calls it a hostel and says it organised the activities.",kind:'Property named in video',query:"Roy's Villa Sigiriya",providers:['Booking.com','Official website'],direct:'https://roysvilla.com/',note:'Room type, current price and booking platform were not established.'},
 { id:'safari',title:'Minneriya elephant safari',place:'Sigiriya',category:'Experiences',source:'sigiriya',second:25.12,quote:'Hostel jeep pickup for Minneriya National Park safari, described as 4–5 hours.',kind:'Comparable experience',query:'Minneriya National Park safari Sigiriya',providers:['Viator','GetYourGuide'],note:'The creator’s safari operator is unknown. A similar tour is not the same booking.'},
 { id:'sunrise',title:'Pidurangala at sunrise',place:'Sigiriya',category:'Experiences',source:'sigiriya',second:39.52,quote:'04:30 wake-up for Pidurangala Rock sunrise hike.',kind:'Place named in video',query:'Pidurangala Rock sunrise hike',providers:['Viator','GetYourGuide']},
 { id:'guided',title:'Three days, train rides & safari',place:'Across Sri Lanka',category:'Experiences',source:'kanisha',second:65,quote:'Creator caption explicitly says booked via GetYourGuide; app/product card visible.',kind:'Booking platform named',query:'Colombo 3-Day All-Inclusive Tour with Ella Train Safari',providers:['GetYourGuide','Viator'],note:'The exact product URL is unverified. This is a compressed route with long transfers, not a relaxed three-day default.'},
 { id:'train',title:'Nanu Oya → Ella',place:'Hill country',category:'Transport',source:'kanisha',second:29.1,quote:'Tea-plantation visit, Nanu Oya–Ella train, then hotel check-in in Ella. Tea estate and hotel unnamed.',kind:'Route named in video',query:'Nanu Oya to Ella train tickets',providers:['Viator','GetYourGuide'],note:'Check departure station, ticket class and collection instructions with the provider.'},
 { id:'coast',title:'A poolside stay on the south coast',place:'Ahangama',category:'Stays',source:'shreya',second:11.36,quote:'Airbnb with breakfast and a pool suggested/shown; listing/property name and price not provided.',kind:'Suggested stay search',query:'Ahangama Sri Lanka',providers:['Booking.com'],note:'The Airbnb listing is unknown. Pool and breakfast must be checked on each listing.'},
 { id:'galle',title:'A day exploring Galle',place:'South coast',category:'Experiences',source:'shreya',second:48.88,quote:'Galle lanes, cafés, boutiques, evening lights and gelato; gelato shop unnamed.',kind:'Comparable experience',query:'Galle Fort walking tour',providers:['Viator','GetYourGuide'],note:'A guided walk is a proposed alternative, not a confirmed booking from the reel.'},
 { id:'beach',title:'Paradise Cove beach day',place:'Midigama',category:'Experiences',source:'shreya',second:28.24,quote:'Slow breakfast and beach beds at Paradise Cove; food and beach time.',kind:'Named venue',query:'Paradise Cove Midigama',providers:['Official website'],direct:'https://paradisecovemidigama.com/',note:'Check day-bed reservations directly with the venue.'},
 ...extraMatches as Match[]
];
export function canonicalKey(value: string) {
 let u: URL; try {u=new URL(value.trim());} catch {throw new Error('Paste a full Instagram Reel or TikTok video URL.');}
 if(u.protocol!=='https:'||u.username||u.password||u.port) throw new Error('Use a public HTTPS video link.');
 const host=u.hostname.toLowerCase(), path=u.pathname.replace(/\/$/,'');
 if(['www.instagram.com','instagram.com'].includes(host)) {const m=path.match(/^\/(?:[\w.]+\/)?(?:reel|reels|p)\/([\w-]+)$/);if(m)return 'instagram-'+m[1];}
 if(['www.tiktok.com','tiktok.com','m.tiktok.com'].includes(host)) {const m=path.match(/^\/@[\w.-]+\/video\/(\d+)$/);if(m)return 'tiktok-'+m[1];}
 throw new Error('Use a direct post link, not a profile or shortened sharing link.');
}
export function validateDates(dates: Window[], today = calendarDay(), allowSameDay = false) {
 if(!Array.isArray(dates)||dates.length<1||dates.length>3) throw new Error('Choose one to three date windows.');
 for(const w of dates){
  const valid=(s:string)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!w||!valid(w.start)||!valid(w.end))throw new Error('Enter valid arrival and departure dates.');
  if(w.start<today||(w.end<w.start||(!allowSameDay&&w.end===w.start)))throw new Error('Departure must be after arrival, and arrival cannot be in the past.');
  if((Date.parse(w.end)-Date.parse(w.start))/86400000>30)throw new Error('Keep each search window to 30 nights or fewer.');
 }
}
export type HotelSearchLink = {provider:'Booking.com'|'Expedia'|'Airbnb';url:string;datesIncluded:boolean;currencyIncluded:boolean;propertyName?:string};
// Evidence labels belong on the card, not in a provider's destination field.
// Match explicit uncertainty phrases, not words inside legitimate place names.
export function searchLocationText(value:string):string{
 const place=value.trim();
 if(/^(?:unknown|unspecified|not specified|not established|various|multiple locations|to (?:be )?confirm(?:ed)?)(?: (?:location|city|region|area))?$/i.test(place)
  ||/\b(?:exact\s+)?(?:location|city|region|area|destination)\s+(?:(?:is\s+)?(?:unknown|unconfirmed|uncertain|unspecified)|to\s+(?:be\s+)?confirm(?:ed)?|not\s+(?:specified|established|confirmed|identified))\b/i.test(place)
  ||/^(?:arrival|departure|overnight|stopover) stop(?:\s*[·—-].*)?$/i.test(place))return '';
 return place;
}
// Keep a named stay in the outgoing search even if extraction supplied a broad
// area-only query. Suggested/unnamed stays keep their original area search.
export function hotelSearchQuery(match:Pick<Match,'title'|'place'|'query'|'kind'>):string{
 let query=(match.query||'').trim();
 const title=(match.title||'').trim(),rawPlace=(match.place||'').trim(),place=searchLocationText(rawPlace);
 if(rawPlace&&!place){
  const start=query.toLocaleLowerCase('en-GB').indexOf(rawPlace.toLocaleLowerCase('en-GB'));
  if(start>=0)query=(query.slice(0,start)+' '+query.slice(start+rawPlace.length)).replace(/\s+/g,' ').trim();
  if(!searchLocationText(query))query=title;
 }
 const normal=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 if(!title||/suggested|unnamed|unknown|area search/i.test(match.kind||''))return query.slice(0,240);
 if(query.length<=240&&normal(query).includes(normal(title)))return query;
 return (title+(place&&!normal(title).includes(normal(place))?' '+place:'')).slice(0,240);
}
export function accommodationMatches(available:Match[],sourceIds:string[]):Match[]{
 const selected=new Set(sourceIds),seen=new Set<string>();
 return available.filter(match=>{const key=match.source+':'+match.id;if(match.category!=='Stays'||!selected.has(match.source)||seen.has(key))return false;seen.add(key);return true;});
}
// Public provider URLs verified in the browser on 2026-11-18. Expedia's legacy
// /go/hotel route dropped occupancy; the current search form uses adults instead.
// Neither provider accepts a verified check-in/check-out time filter here.
export function hotelSearchLinks(query:string,dates?:Window,adults=2,currency='GBP'):HotelSearchLink[]{
 const destination=typeof query==='string'?query.trim():'';
 if(!destination||destination.length>240||!Number.isInteger(adults)||adults<1||adults>8||!['GBP','EUR','USD','INR'].includes(currency))return [];
 if(dates!==undefined){try{validateDates([dates]);}catch{return [];}}
 const booking=new URL('https://www.booking.com/searchresults.html');
 booking.searchParams.set('ss',destination);
 booking.searchParams.set('group_adults',String(adults));
 booking.searchParams.set('no_rooms','1');
 booking.searchParams.set('group_children','0');
 booking.searchParams.set('selected_currency',currency);
 const expedia=new URL('https://www.expedia.com/Hotel-Search');
 expedia.searchParams.set('destination',destination);
 expedia.searchParams.set('adults',String(adults));
 const airbnb=new URL('https://www.airbnb.com/s/'+encodeURIComponent(destination)+'/homes');
 airbnb.searchParams.set('adults',String(adults));
 if(dates){
  booking.searchParams.set('checkin',dates.start);booking.searchParams.set('checkout',dates.end);
  expedia.searchParams.set('startDate',dates.start);expedia.searchParams.set('endDate',dates.end);
  airbnb.searchParams.set('checkin',dates.start);airbnb.searchParams.set('checkout',dates.end);
 }
 // Expedia controls currency through its region settings; do not claim that the
 // traveller's currency transfers via an undocumented URL parameter.
 return [{provider:'Booking.com',url:booking.href,datesIncluded:!!dates,currencyIncluded:true},{provider:'Expedia',url:expedia.href,datesIncluded:!!dates,currencyIncluded:false},{provider:'Airbnb',url:airbnb.href,datesIncluded:!!dates,currencyIncluded:false}];
}
// Verified 2026-11-18 against Booking.com's property page; the user confirmed
// that their "Kotawa Village" meant this property in Udawalawe. This resolves
// an existing named source card only: it never adds or rewrites reel evidence.
// https://www.booking.com/hotel/lk/kottawatta-village.html
export function hotelProviderLinks(match:Pick<Match,'title'|'place'|'query'|'kind'|'category'>,dates?:Window,adults=2,currency='GBP'):HotelSearchLink[]{
 const links=hotelSearchLinks(hotelSearchQuery(match),dates,adults,currency);
 const normal=(value:string)=>(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const title=normal(match.title),place=normal(match.place);
 const named=match.category==='Stays'&&!/suggested|unnamed|unknown|area search|alternative|comparable/i.test(match.kind);
 const exact=named&&/^(?:kottawatta|kotawa) village(?: (?:udawalawe|udawalawa|uda walawe)(?: sri lanka)?)?$/.test(title)&&/^(?:udawalawe|udawalawa|uda walawe)(?: sri lanka)?$/.test(place);
 if(!exact)return links;
 return links.map(link=>{
  if(link.provider!=='Booking.com')return link;
  const url=new URL(link.url);url.pathname='/hotel/lk/kottawatta-village.html';url.searchParams.delete('ss');
  return {...link,url:url.href,propertyName:'Kottawatta Village'};
 });
}
export function providerUrl(m:Match, provider:string, dates:Window, adults:number, currency:string, dining?:Dining) {
 if(provider==='OpenTable') {
  const meal=dining||{date:dates.start,time:'19:00',covers:adults};
  const params=new URLSearchParams({term:m.query,dateTime:meal.date+' '+meal.time,covers:String(meal.covers)});
  if(m.diningMetroId)params.set('metroId',m.diningMetroId);
  return 'https://www.opentable.com/s?'+params;
 }
 if(provider==='Official website') return m.direct || '';
 if(provider==='Booking.com'||provider==='Expedia'||provider==='Airbnb')return hotelProviderLinks(m,dates,adults,currency).find(link=>link.provider===provider)?.url||'';
 // These public search routes do not have a documented date contract. Dates are
 // deliberately not guessed; the UI tells the user to re-enter them there.
 if(provider==='Viator') return 'https://www.viator.com/searchResults/all?'+new URLSearchParams({text:m.query});
 if(provider==='GetYourGuide')return getYourGuideSearchUrl(m.query);
 return '';
}
// Browsing a breakdown must not invent dates before the traveller chooses them.
export function browseProviderUrl(m:Match,provider:string):string{
 if(provider==='Official website')return m.direct||'';
 if(provider==='Booking.com'||provider==='Expedia'||provider==='Airbnb')return hotelProviderLinks(m).find(link=>link.provider===provider)?.url||'';
 if(provider==='OpenTable')return 'https://www.opentable.com/s?'+new URLSearchParams({term:m.query});
 if(provider==='Viator')return 'https://www.viator.com/searchResults/all?'+new URLSearchParams({text:m.query});
 if(provider==='GetYourGuide')return getYourGuideSearchUrl(m.query);
 return '';
}
export function rankedMatches(selected:string[], prompt:string) {
 const terms=prompt.toLowerCase().match(/[a-z]{4,}/g)||[];
 return matches.filter(m=>selected.includes(m.source)).map(m=>({m,score:terms.filter(t=>(m.title+' '+m.place+' '+m.category+' '+m.query).toLowerCase().includes(t)).length})).sort((a,b)=>b.score-a.score).map(x=>x.m);
}
export function viatorSearchBody(query:string, dates:Window, currency:string,destination?:string){return {searchTerm:query,searchTypes:[{searchType:'PRODUCTS',pagination:{start:1,count:6}}],currency,productFiltering:{...(destination?{destination}:{}),dateRange:{from:dates.start,to:dates.end}}};}

export type Dining = { date:string; time:string; covers:number };
export function diningDays(dates:Window):string[]{
 const start=Date.parse(dates.start),end=Date.parse(dates.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>30*86400000)return [];
 return Array.from({length:Math.floor((end-start)/86400000)+1},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
}
export function diningSelection(trip:Trip):Dining {
 const dates=trip.dates[trip.activeDate]||trip.dates[0],days=diningDays(dates);
 return {date:days.includes(trip.diningDate||'')?trip.diningDate!:dates.start,time:trip.diningTime||'19:00',covers:trip.diners??trip.adults};
}
export function validateDining(meal:Dining,dates:Window,today=calendarDay()){
 validateDates([dates],today);
 if(!diningDays(dates).includes(meal.date))throw new Error('Choose a dining date within this trip option.');
 if(!/^([01]\d|2[0-3]):(00|30)$/.test(meal.time))throw new Error('Choose a valid dining time.');
 if(!Number.isInteger(meal.covers)||meal.covers<1||meal.covers>20)throw new Error('Choose between 1 and 20 diners.');
}
