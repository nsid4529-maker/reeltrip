import {searchLocationText,hotelSearchQuery,type Match} from './travel.ts';
import {matchedBookingPage,bookingPageUrl,getYourGuideSearchUrl} from './booking-pages.ts';

// Booking hand-off: links that open a partner with the plan filled in. ReelTrip
// shows no prices (it has none) and never books; the partner's page decides.
//
// Parameters verified in a live browser on 22 November 2026:
// - Booking.com /searchresults.html: ss, checkin, checkout (YYYY-MM-DD),
//   group_adults, no_rooms, group_children → "Fri 15 Jan — Mon 18 Jan",
//   "4 adults · 0 children · 2 rooms".
// - Expedia /Hotel-Search: destination, startDate, endDate (YYYY-MM-DD) and
//   adults as one number per room, comma-separated ("2,2" → "4 travelers, 2 rooms").
export type Partner='booking'|'expedia'|'opentable'|'sevenrooms'|'getyourguide';
export type LinkType='stay_search'|'stay_property'|'place_reserve'|'activity_search';
export type HandoffLink={partner:Partner;partnerName:string;label:string;url:string;linkType:LinkType;referral:boolean};
export const PARTNER_NAMES:Record<Partner,string>={booking:'Booking.com',expedia:'Expedia',opentable:'OpenTable',sevenrooms:'SevenRooms',getyourguide:'GetYourGuide'};

// Affiliate IDs, added later as a one-line change each: put the query parameter
// name and ID your partner programme gives you, e.g. {param:'aid',id:'1234567'}.
// While null, links are plain public links and no commission note is shown.
export const STAY_REFERRALS:{booking:{param:string;id:string}|null;expedia:{param:string;id:string}|null}={booking:null,expedia:null};

// "15 Jan – 18 Jan 2027" for display; the links keep YYYY-MM-DD.
export function tripDates(start:string|null,end:string|null){
 const s=day(start),e=day(end);if(!s||!e)return 'dates not set yet';
 const f=(v:string,year:boolean)=>new Date(v+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});
 return f(s,s.slice(0,4)!==e.slice(0,4))+' – '+f(e,true);
}
export const beforeYouBook=(partnerName:string)=>`Check the total price and cancellation terms on ${partnerName} before you book.`;
export const COMMISSION_NOTE='ReelTrip may earn a commission if you book through this link.';

const day=(value:string|null|undefined)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null;
// Two adults per room, as most hotel rooms sleep two.
export const roomsFor=(adults:number)=>Math.ceil(adults/2);
export function adultsPerRoom(adults:number){const rooms=roomsFor(adults);return Array.from({length:rooms},(_,i)=>Math.floor(adults/rooms)+(i<adults%rooms?1:0));}
function refer(url:URL,referral:{param:string;id:string}|null){if(referral)url.searchParams.set(referral.param,referral.id);return !!referral;}

export type Trip={start:string|null;end:string|null;travellers:number};
export function stayLinks(area:string,trip:Trip,linkType:LinkType='stay_search'):HandoffLink[]{
 const where=area.trim();
 if(!where||where.length>240||!Number.isInteger(trip.travellers)||trip.travellers<1||trip.travellers>12)return [];
 const start=day(trip.start),end=day(trip.end),dated=!!start&&!!end&&start<end;
 const booking=new URL('https://www.booking.com/searchresults.html');
 booking.searchParams.set('ss',where);
 if(dated){booking.searchParams.set('checkin',start!);booking.searchParams.set('checkout',end!);}
 booking.searchParams.set('group_adults',String(trip.travellers));booking.searchParams.set('no_rooms',String(roomsFor(trip.travellers)));booking.searchParams.set('group_children','0');
 const expedia=new URL('https://www.expedia.com/Hotel-Search');
 expedia.searchParams.set('destination',where);
 if(dated){expedia.searchParams.set('startDate',start!);expedia.searchParams.set('endDate',end!);}
 expedia.searchParams.set('adults',adultsPerRoom(trip.travellers).join(','));
 const verb=linkType==='stay_property'?'Check availability on ':'Find a place on ';
 return [
  {partner:'booking',partnerName:'Booking.com',label:verb+'Booking.com',url:'',linkType,referral:refer(booking,STAY_REFERRALS.booking)},
  {partner:'expedia',partnerName:'Expedia',label:verb+'Expedia',url:'',linkType,referral:refer(expedia,STAY_REFERRALS.expedia)},
 ].map((link,i)=>({...link,url:(i===0?booking:expedia).href})) as HandoffLink[];
}

// The bucket's area for "Find a place to stay": the most common place named by
// its matched places (ReelTrip's own reel data), else the bucket name.
export function stayArea(places:{place:string}[],fallback:string){
 const counts=new Map<string,{text:string;n:number}>();
 for(const p of places){const text=searchLocationText(p.place||'');if(!text)continue;const key=text.toLowerCase();const c=counts.get(key)||{text,n:0};c.n++;counts.set(key,c);}
 const best=[...counts.values()].sort((a,b)=>b.n-a.n)[0];
 return best?best.text:fallback.trim();
}

export type PlaceForLinks=Pick<Match,'title'|'place'|'query'|'kind'|'category'>;
// A place gets a link only where the app already has a verified route: a
// reviewed restaurant booking page, GetYourGuide's referral search for named
// activities, or a stay search by the property's name. Never a made-up link.
export function placeLinks(raw:Partial<PlaceForLinks>,trip:Trip):HandoffLink[]{
 // Older shared snapshots have no query or kind; fill them so the reused helpers never see undefined.
 const title=raw.title||'',area=raw.place||'';
 const place={title,place:area,query:raw.query||[title,area].filter(Boolean).join(' '),kind:raw.kind||'',category:raw.category||''} as PlaceForLinks;
 // A link is a nice-to-have: building one must never break the place card.
 try{return linksFor(place,trip);}catch{return [];}
}
function linksFor(place:PlaceForLinks,trip:Trip):HandoffLink[]{
 const named=!/unnamed|unknown|uncertain|unverified|suggested|alternative|area search|comparable|route|booking platform/i.test(place.kind||'');
 if(place.category==='Food'){
  const page=matchedBookingPage(place as Match);if(!page)return [];
  const partner:Partner=page.provider==='OpenTable'?'opentable':'sevenrooms';
  return [{partner,partnerName:page.provider,label:'Reserve on '+page.provider,url:bookingPageUrl(page),linkType:'place_reserve',referral:false}];
 }
 if(place.category==='Experiences'&&named&&place.query)return [{partner:'getyourguide',partnerName:'GetYourGuide',label:'Find tours on GetYourGuide',url:getYourGuideSearchUrl(place.query),linkType:'activity_search',referral:true}];
 if(place.category==='Stays'&&named)return stayLinks(hotelSearchQuery(place),trip,'stay_property');
 return [];
}
