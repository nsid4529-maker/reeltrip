import {bookingPages,bookingPageUrl,type BookingPage} from './booking-pages.ts';
import type {Dining} from './travel.ts';

/** Public diner destinations reviewed on 18 November 2026. These are not APIs. */
export const restaurantRegions = [
  {id:'global', label:'Choose a region / elsewhere', note:'Search booking websites for this restaurant by name and location. Coverage varies by venue.'},
  {id:'uk-ireland', label:'United Kingdom or Ireland', note:'Search OpenTable for this restaurant and check the name and city. A search does not confirm a listing.'},
  {id:'us-canada', label:'United States or Canada', note:'Search OpenTable for this restaurant and check the name and city. A search does not confirm a listing.'},
  {id:'sri-lanka', label:'Sri Lanka', note:'Search Eat App, MyTable and TableAgent for this restaurant. They cover different venues; a search does not confirm a listing.'},
  {id:'europe', label:'Europe', note:'TheFork covers selected European destinations. Check the exact city and restaurant on its website.'},
  {id:'japan', label:'Japan', note:'Search TableCheck for this restaurant in Japan. Confirm its listing, dates and party size there.'},
  {id:'singapore', label:'Singapore', note:'TableCheck, Eatigo and Eat App have Singapore options. Each has different restaurant coverage.'},
  {id:'selected-asia', label:'Thailand, Malaysia, Hong Kong, Philippines or Taiwan', note:'Eatigo supports these markets. Select your city on its website; not every restaurant participates.'},
  {id:'middle-east', label:'Middle East', note:'Eat App lists several Middle Eastern destinations. Choose the exact city on its website.'},
  {id:'india', label:'India', note:'Search Eat App for this restaurant in India, or find the venue’s own booking and contact details.'},
  {id:'maldives', label:'Maldives', note:'Search Eat App for this restaurant in the Maldives, or contact the venue directly.'},
] as const;

export type RestaurantRegion = typeof restaurantRegions[number]['id'];
export type RestaurantLink = {
  id:string;
  provider:string;
  label:string;
  url:string;
  kind:'search'|'website'|'venue';
  mealIncluded?:boolean;
  detail:string;
};

const searchProviders: Record<RestaurantRegion, Array<[string,string,string]>> = {
  global:[['eat-app','Eat App','https://eatapp.co/'],['opentable','OpenTable','https://www.opentable.com/'],['sevenrooms','SevenRooms','https://www.sevenrooms.com/'],['tablecheck','TableCheck','https://www.tablecheck.com/'],['thefork','TheFork','https://www.thefork.com/']],
  'uk-ireland':[['opentable','OpenTable','https://www.opentable.co.uk/']],
  'us-canada':[['opentable','OpenTable','https://www.opentable.com/']],
  'sri-lanka':[['eat-app','Eat App','https://eatapp.co/sri-lanka'],['mytable','MyTable','https://mytable.lk/'],['tableagent','TableAgent','https://tableagent.com/']],
  europe:[['thefork','TheFork','https://www.thefork.com/']],
  japan:[['tablecheck','TableCheck','https://www.tablecheck.com/en/japan']],
  singapore:[['tablecheck','TableCheck','https://www.tablecheck.com/en/singapore'],['eatigo','Eatigo','https://eatigo.com/en'],['eat-app','Eat App','https://eatapp.co/singapore']],
  'selected-asia':[['eatigo','Eatigo','https://eatigo.com/en']],
  'middle-east':[['eat-app','Eat App','https://eatapp.co/']],
  india:[['eat-app','Eat App','https://eatapp.co/india']],
  maldives:[['eat-app','Eat App','https://eatapp.co/maldives']],
};

export function restaurantRegion(value?:string): RestaurantRegion {
  return restaurantRegions.some(region=>region.id===value) ? value as RestaurantRegion : 'global';
}

function clean(value:string, limit:number):string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,limit).join('');
}

/** Maps URL format is documented publicly and does not require a Places API key. */
export function restaurantMapSearch(query:string, place:string):string {
  const name=clean(query,240), location=clean(place,160);
  let text=[name || 'restaurants', location && !name.toLocaleLowerCase().includes(location.toLocaleLowerCase()) ? location : ''].filter(Boolean).join(' ');
  const build=(value:string)=>`https://www.google.com/maps/search/?${new URLSearchParams({api:'1',query:value})}`;
  // Maps documents a 2,048-character limit; Unicode percent encoding can expand input.
  while(build(text).length>2048) text=Array.from(text).slice(0,-1).join('');
  return build(text);
}

/** A source-provided website is still not a verified restaurant/provider match. */
export function safeRestaurantWebsite(value?:string):string|undefined {
  if(!value || value.length>2048 || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url=new URL(value);
    const host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443')) return;
    if(!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return;
    return url.href;
  } catch { return; }
}

type VerifiedVenue={id:string;name:string;names:string[];locations:string[];country:string;links:[string,string,string][];bookingPage?:BookingPage};
// Exact pages checked 18 Nov 2026. Matching these pages does not change reel evidence.
const verifiedVenues:VerifiedVenue[]=[
 {id:'kai-ahangama',name:'Kai Ahangama',names:['Kai Ahangama Rooftop Cafe and Bar','Kai Ahangama'],locations:['Ahangama'],country:'Sri Lanka',links:[
  ['MyTable','https://mytable.lk/venues/63','Exact Kai Ahangama listing. Select and confirm your party, date and time on MyTable.'],
  ['Venue website','https://discoverkai.com/properties/kai-ahangama/','Official Ahangama venue page with table-booking information. Check party restrictions with the venue.']]},
 {id:'paradise-cove-midigama',name:'Paradise Cove',names:['Paradise Cove Midigama','Paradise Cove'],locations:['Midigama'],country:'Sri Lanka',links:[
  ['Classcruiser','https://paradisecovemidigama.classcruiser.com/reservation','Reservation page linked by the official Paradise Cove website. Choose your date, time and guests there.'],
  ['TableAgent','https://tableagent.com/colombo/paradise-cove/','Exact Paradise Cove listing with the Midigama address. Check current booking options with the provider.'],
  ['Venue website','https://paradisecovemidigama.com/','Official Paradise Cove Midigama website and contact details.']]},
 {id:'smoke-bitters',name:'Smoke & Bitters',names:['Smoke and Bitters'],locations:['Hiriketiya','Dickwella','Dikwella'],country:'Sri Lanka',links:[
  ['Venue website','https://www.smokeandbitters.com/contact','The venue directs reservation requests to WhatsApp. Contact the venue to request a table; no booking is made here.']]},
 ...bookingPages.map((page):VerifiedVenue=>({id:page.id,name:page.name,names:page.names,locations:page.locations,country:'United Kingdom',bookingPage:page,links:[]})),
];
const words=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const contains=(value:string,phrase:string)=>(' '+words(value)+' ').includes(' '+words(phrase)+' ');

export function verifiedRestaurantLinks({query,place,kind,meal}:{query:string;place:string;kind?:string;meal?:Dining}):RestaurantLink[]{
 if(/unnamed|unknown|uncertain|unverified|suggested|alternative|area search|comparable|location to confirm/i.test([kind,query,place].filter(Boolean).join(' ')))return [];
 const candidates=verifiedVenues.filter(venue=>{
  if(!venue.locations.some(location=>contains(place||query,location)))return false;
  const name=venue.names.find(name=>contains(query,name));
  if(!name)return false;
  // Reject mixed-venue or contradictory queries instead of resolving a partial name.
  const allowed=new Set(words([...venue.locations,venue.country,'area'].join(' ')).split(' '));
  return words(query).replace(words(name),' ').trim().split(/\s+/).filter(Boolean).every(word=>allowed.has(word));
 });
 if(candidates.length!==1)return [];
 const venue=candidates[0];
 const links=venue.links.map(([provider,url,detail],index):RestaurantLink=>({id:venue.id+'-'+index,provider,url,kind:'venue',label:provider==='Venue website'?'Open '+venue.name+' website':'Open '+venue.name+' on '+provider,detail}));
 if(venue.bookingPage){
  const page=venue.bookingPage,url=bookingPageUrl(page,meal);
  links.unshift({id:page.id+'-booking',provider:page.provider,url,kind:'venue',label:'Open '+page.name+' on '+page.provider,mealIncluded:url!==page.url,detail:'Exact venue page reviewed on '+page.checkedOn+'. Check current availability on the provider.'});
 }
 return links;
}

function providerNameSearch(directory:string,query:string,place:string):string{
 const domain=new URL(directory).hostname.replace(/^www\./,'');
 const name=clean(query,240)||'restaurants',location=clean(place,160);
 let text=[name,location&&!name.toLocaleLowerCase().includes(location.toLocaleLowerCase())?location:''].filter(Boolean).join(' ');
 const build=()=>`https://www.google.com/search?${new URLSearchParams({q:'site:'+domain+' '+text})}`;
 while(build().length>2048)text=Array.from(text).slice(0,-1).join('');
 return build();
}

export function restaurantSearchLinks({query,place,region,direct,kind,meal}:{query:string;place:string;region?:string;direct?:string;kind?:string;meal?:Dining}):RestaurantLink[] {
 const selected=restaurantRegion(region),verified=verifiedRestaurantLinks({query,place,kind,meal});
 const links:RestaurantLink[]=[...verified,{
  id:'maps',provider:'Google Maps',label:'Find '+(clean(query,80)||'restaurants')+' on Maps',url:restaurantMapSearch(query,place),kind:'search',
  detail:'Search by name and location for the venue’s website, phone number and directions.',
 }];
 const website=safeRestaurantWebsite(direct);
 if(website&&!verified.some(link=>link.url===website))links.push({id:'venue-website',provider:'Venue website',label:'Open linked website',url:website,kind:'website',detail:'Link supplied with this place. Confirm the name and location before booking.'});
 links.push(...searchProviders[selected].filter(([,provider])=>!verified.some(link=>link.provider===provider)).map(([id,provider,directory]):RestaurantLink=>({
  id,provider,url:providerNameSearch(directory,query,place),kind:'search',label:`Search ${provider} for ${clean(query,80)||'restaurants'}`,
  detail:`Web search limited to ${new URL(directory).hostname} using this restaurant’s name and location. No exact listing or availability is confirmed.`,
 })));
 return links;
}
