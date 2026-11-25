import type {Dining, Match} from './travel.ts';

export type BookingPage = {
 id:string; name:string; city:string; address:string;
 provider:'OpenTable'|'SevenRooms'; url:string; image:string;
 checkedOn:string; names:string[]; locations:string[];
};

// Public booking pages reviewed in the browser. Never derive a venue slug from
// model output or treat an arbitrary URL in a reel as a verified booking page.
export const bookingPages:BookingPage[]=[
 {id:'oudh-1722-london',name:'Oudh 1722',city:'London',address:'66 Union Street, London',provider:'SevenRooms',url:'https://www.sevenrooms.com/explore/oudh1722/reservations/create/search',image:'/booking-previews/oudh-1722.jpg',checkedOn:'2026-11-18',names:['Oudh 1722','Oudh1722'],locations:['London']},
 {id:'ivy-in-the-park-london',name:'The Ivy in the Park',city:'London',address:'50 Canada Square Park, Canary Wharf, London E14 5FW',provider:'OpenTable',url:'https://www.opentable.co.uk/r/the-ivy-in-the-park-london',image:'/booking-previews/ivy-in-the-park.jpg',checkedOn:'2026-11-18',names:['The Ivy in the Park','Ivy in the Park'],locations:['London','Canary Wharf']}
];
const words=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const contains=(value:string,phrase:string)=>(' '+words(value)+' ').includes(' '+words(phrase)+' ');
export function matchedBookingPage(m:Match):BookingPage|undefined{
 if(m.category!=='Food'||/unnamed|unknown|uncertain|unverified|suggested|alternative|area search|comparable/i.test(m.kind))return;
 const candidates=bookingPages.filter(v=>v.names.some(n=>contains(m.title,n)||contains(m.query,n)));
 // A name and location must agree, and ambiguous multi-venue mentions stay a search.
 if(candidates.length!==1)return;
 const v=candidates[0];
 if(v.locations.some(location=>contains(m.place,location)||contains(m.query,location)))return v;
}
export function bookingPageUrl(page:BookingPage,meal?:Dining):string{
 if(!meal)return page.url;
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(meal.date)&&Number.isFinite(Date.parse(meal.date))&&new Date(meal.date).toISOString().slice(0,10)===meal.date;
 if(!validDate||!/^([01]\d|2[0-3]):(00|30)$/.test(meal.time)||!Number.isInteger(meal.covers)||meal.covers<1||meal.covers>20)return page.url;
 const url=new URL(page.url);
 // Verified against each provider’s visible controls, including a fresh page load.
 url.search=new URLSearchParams(page.provider==='OpenTable'
  ?{dateTime:meal.date+'T'+meal.time,covers:String(meal.covers)}
  :{date:meal.date,party_size:String(meal.covers),start_time:meal.time}).toString();
 return url.href;
}

// Public referral identifier, verified in this owner's GetYourGuide link builder.
export const GETYOURGUIDE_PARTNER_ID='EXAMPLE_PARTNER';
export function getYourGuideSearchUrl(query:string):string{
 return 'https://www.getyourguide.com/s/?'+new URLSearchParams({q:query,partner_id:GETYOURGUIDE_PARTNER_ID,utm_medium:'local_partners',cmp:'reeltrip'});
}
