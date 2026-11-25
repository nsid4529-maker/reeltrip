'use client';
import {useState} from 'react';
import {ArrowUpRight,CalendarDays} from 'lucide-react';
import {activityQuery,activitySearchUrl,getYourGuideActivity,getYourGuideActivityUrl,getYourGuideEmbed} from '@/lib/getyourguide';
import {itemForGetYourGuide} from '@/lib/interested';
import {InterestedButton} from './interested';

export function GetYourGuideOptions({query,date='',end='',adults=2,currency='GBP',initialActivity=''}:{query:string;date?:string;end?:string;adults?:number;currency?:string;initialActivity?:string}){
 const [boats,setBoats]=useState(false),[kids,setKids]=useState(false),[loaded,setLoaded]=useState(false),[activityURL,setActivityURL]=useState(initialActivity),[activityName,setActivityName]=useState(''),[showCalendar,setShowCalendar]=useState(false);
 const interests={boats,kids},search=activityQuery(query,interests),activity=getYourGuideActivity(activityURL);
 const context=JSON.stringify([search,date,end,adults,currency,showCalendar,activity?.id]);
 const preview=getYourGuideEmbed(showCalendar&&activity?{activityUrl:activity.url,currency}:{query:search});
 const interest=itemForGetYourGuide(activityURL,activityName);
 return <div className="gyg-options">
  <div className="tabs" role="group" aria-label="Activity interests"><button className={!boats&&!kids?'active':''} onClick={()=>{setBoats(false);setKids(false);}}>All activities</button><button aria-pressed={boats} className={boats?'active':''} onClick={()=>setBoats(v=>!v)}>Boat cruises</button><button aria-pressed={kids} className={kids?'active':''} onClick={()=>setKids(v=>!v)}>For kids</button></div>
  <p className="fine-print">Search interests: {search}. Check age limits and inclusions on each activity.</p>
  <p className="fine-print">Activity suggestions use GetYourGuide’s currency, which may differ from your selected {currency}. Confirm currency and totals on GetYourGuide. Your selected currency is passed to individual activity calendars.</p>
  <div className="state-actions"><button className="primary" onClick={()=>{setLoaded(true);setShowCalendar(false);}}>Show GetYourGuide options</button><a className="provider-link" href={activitySearchUrl(query,interests,date,end)} target="_blank" rel="noopener noreferrer sponsored">Open filtered results<ArrowUpRight size={14}/></a></div>
  <details className="activity-link-entry" open={!!initialActivity}>
   <summary>Save an activity or preview its calendar</summary>
   <p className="fine-print">Found something in the preview? Open its activity page, copy the link, and paste it here to add it to Interested. GetYourGuide controls the buttons inside its preview.</p>
   <label>GetYourGuide activity link<input aria-label="GetYourGuide activity link" value={activityURL} onChange={e=>{setActivityURL(e.target.value);setActivityName('');setShowCalendar(false);}} placeholder="Paste the individual activity’s GetYourGuide link" maxLength={2048}/></label>
   <label>Activity name (optional)<input aria-label="Name for interested activity" value={activityName} onChange={e=>setActivityName(e.target.value)} placeholder="A name to recognise this activity" maxLength={240}/></label>
   {activityURL&&!activity&&<p role="status">Use an individual GetYourGuide activity link, rather than a city or search page.</p>}
   <div className="state-actions"><button className="secondary" disabled={!activity} onClick={()=>{setLoaded(true);setShowCalendar(true);}}><CalendarDays size={15}/>Preview availability calendar</button>{activity&&<a className="provider-link" href={getYourGuideActivityUrl(activity.url,date,adults)!} target="_blank" rel="noopener noreferrer sponsored">Open activity to book<ArrowUpRight size={14}/></a>}</div>
   {interest&&<InterestedButton item={interest}/>}
  </details>
  {loaded&&<div className="provider-widget"><div className="provider-widget-label"><strong>{showCalendar?'GetYourGuide availability calendar':'GetYourGuide activity options'}</strong><span>Provided by GetYourGuide</span></div><p className="fine-print">{showCalendar?'Select your date and party inside this calendar. The direct activity link includes your selected date and adult count.':'These are provider suggestions for your search interests. Confirm your dates and party on the activity page; a starting price does not confirm availability.'}</p><iframe key={context} title={showCalendar?'GetYourGuide availability preview':'GetYourGuide activity options preview'} srcDoc={preview} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" className={showCalendar?'availability-widget':'activities-widget'}/><p className="fine-print">If the preview does not load, use the provider links above.</p></div>}
  <p className="affiliate-note">Preview loads GetYourGuide content and its tracking. ReelTrip may earn a commission from bookings.</p>
 </div>;
}
