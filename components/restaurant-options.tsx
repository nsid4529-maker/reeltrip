'use client';
import {useId,useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import type {Dining} from '@/lib/travel';
import {restaurantRegions,restaurantRegion,restaurantSearchLinks,type RestaurantRegion,type RestaurantLink} from '@/lib/restaurant-links';

export function RestaurantOptions({query,place,direct,meal,kind}:{query:string;place:string;direct?:string;meal?:Dining;kind?:string}) {
  const id=useId();
  const [region,setRegion]=useState<RestaurantRegion>('global');
  const selected=restaurantRegions.find(option=>option.id===region)!;
  const links=restaurantSearchLinks({query,place,direct,region,kind,meal});
  const exact=links.filter(link=>link.kind==='venue'),searches=links.filter(link=>link.kind!=='venue');
  const carried=exact.filter(link=>link.mealIncluded).map(link=>link.provider);
  const renderLinks=(items:RestaurantLink[])=>items.map(link=><a className="provider-link" key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" title={link.detail}>{link.label}<ArrowUpRight size={14}/></a>);
  const searchOptions=<>
    <div className="restaurant-region"><label htmlFor={id}>Search booking websites in</label><select id={id} value={region} onChange={event=>setRegion(restaurantRegion(event.target.value))}>{restaurantRegions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
    <p className="fine-print">{selected.note}</p>
    <div className="provider-links">{renderLinks(searches)}</div>
    <p className="fine-print">Search links include this restaurant’s name and location. Booking-site searches open Google results limited to that provider; they may have no matching listing. Maps can help find the venue’s own website or phone number.</p>
  </>;
  return <section className="restaurant-options" aria-label="Restaurant booking alternatives">
    {exact.length>0?<><p className="fine-print">Matched venue pages · checked 18 November 2026</p><div className="provider-links">{renderLinks(exact)}</div>{exact.map(link=><p className="fine-print" key={link.id}>{link.provider}: {link.detail}</p>)}<details className="restaurant-alternatives"><summary>Search other booking websites</summary>{searchOptions}</details></>:searchOptions}
    <p className="fine-print">{meal?(carried.length?`Your dining date, time and guests are included for ${carried.join(' and ')}. Confirm these on the provider. `:'')+'Choose your dining details again on other booking websites. ':''}Opening a page does not reserve a table. The provider or venue confirms availability and booking.</p>
  </section>;
}
