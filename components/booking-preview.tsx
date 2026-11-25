'use client';
import {useState} from 'react';
import {ArrowUpRight,MapPin,ExternalLink} from 'lucide-react';
import {bookingPageUrl,type BookingPage} from '@/lib/booking-pages';
import type {Dining} from '@/lib/travel';
import {InterestedButton} from './interested';

export function BookingPreview({page,meal,tripId}:{page:BookingPage;meal?:Dining;tripId?:string}){
 const [imageFailed,setImageFailed]=useState(false);
 const url=bookingPageUrl(page,meal),includesPreferences=!!meal&&url!==page.url;
 return <article className="booking-preview" aria-label={page.name+' reservation preview'}>
  {!imageFailed&&<img className="booking-preview-image" src={page.image} alt={'Snippet from '+page.name+'’s '+page.provider+' page'} loading="lazy" onError={()=>setImageFailed(true)}/>}
  <div className="booking-preview-body">
   <div className="booking-preview-provider"><ExternalLink size={13}/>{page.provider} · Restaurant reservation page</div>
   <h3>{page.name}</h3><p className="booking-preview-address"><MapPin size={14}/>{page.address}</p>
   {includesPreferences&&meal&&<p className="booking-preview-request">Your plan: {meal.date} · {meal.time} · {meal.covers} {meal.covers===1?'guest':'guests'}</p>}
   <p>{includesPreferences?'Your date, time and guest count are included. Confirm them on '+page.provider+'.':'Choose your date, time and party size on '+page.provider+'.'}</p>
   <a className="primary" href={url} target="_blank" rel="noopener noreferrer">Open reservation page<ArrowUpRight size={15}/></a>
   <InterestedButton item={{kind:'restaurant',title:page.name,place:page.city,provider:page.provider,url:page.url}} tripId={tripId}/>
   <small>Page snippet captured {page.checkedOn}. Check current tables and complete your booking on {page.provider}.</small>
  </div>
 </article>;
}
