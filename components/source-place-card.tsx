'use client';
import {ArrowUpRight,MapPin} from 'lucide-react';
import type {VideoSource} from '@/lib/analysis';
import type {ChatPreferences} from '@/lib/bundle-chat';
import type {Dining,Match} from '@/lib/travel';
import {choiceDates,savedChoiceHandoff} from '@/lib/saved-choice-links';
import {itemForMatch,type InterestInput} from '@/lib/interested';
import {providerProduct} from '@/lib/provider-links-save';
import {ProviderLinks} from '@/components/provider-links';
import {InterestedButton} from '@/components/interested';
import {PlaceMatch} from '@/components/place-match';

export function SourcePlaceCard({match,source,preferences,tripId,meal}:{match:Match;source?:VideoSource;preferences?:ChatPreferences;tripId?:string;meal?:Dining}){
 const dates=choiceDates(preferences,match.category==='Stays');
 const suggested=/suggested|alternative|comparable|area search/i.test(match.kind),uncertain=/AI|uncertain|unnamed|unverified|unknown/i.test(match.kind);
 const label=suggested?'Suggested by ReelTrip':uncertain?'Reel analysis · confirm details':'Mentioned in the reel';
 return <article className="source-place-card">
  <div className="preview-card-meta"><span>{label}</span><span>{match.category==='Experiences'?'Activity':match.category==='Food'?'Restaurant':match.category==='Stays'?'Stay':'Transport'}</span></div>
  <h3>{match.title}</h3><p className="preview-card-place"><MapPin size={13}/>{match.place}</p>
  <p className="preview-card-note">{match.note||match.kind}</p>
  {source&&<a className="preview-card-original" href={source.source_url} target="_blank" rel="noopener noreferrer">{source.platform==='Uploaded video'?'Watch uploaded video':'Watch original'} · {Math.floor(match.second/60)}:{String(Math.floor(match.second%60)).padStart(2,'0')}<ArrowUpRight size={13}/></a>}
  <PlaceMatch place={{key:match.id,title:match.title,place:match.place,query:match.query,kind:match.kind,category:match.category}} source={source&&source.platform!=='Uploaded video'?{url:source.source_url,creator:source.creator,second:match.second}:undefined}/>
  <ProviderLinks match={match} dates={dates} adults={preferences?.adults} currency={preferences?.currency} meal={meal} tripId={tripId}/>
  {match.category==='Transport'&&<InterestedButton item={itemForMatch(match)} tripId={tripId}/>}
  <p className="fine-print">{match.category==='Food'&&!meal?'Choose the dining date, time and guests on the reservation page. ':''}{preferences&&!dates?'Choose valid dates to include them in booking links. ':''}Provider searches and previews do not confirm price or availability.</p>
 </article>;
}
export function SavedChoiceCard({item,tripId,preferences}:{item:InterestInput;tripId?:string;preferences?:ChatPreferences}){
 const product=providerProduct(item.url),flight=product?.kind==='flight',handoff=savedChoiceHandoff(item,preferences),active=preferences?.dates[preferences.activeDate];
 return <article className="source-place-card saved-choice-card"><div className="preview-card-meta"><span>Your saved choice</span><span>{product?.provider||item.provider}</span></div><h3>{item.title}</h3><p className="preview-card-place"><MapPin size={13}/>{item.place||'Location to confirm'}</p>{flight&&<p className="preview-card-note"><strong>Original saved search:</strong> {product.defaultTitle} · {new URL(product.url).searchParams.get('adultsv2')} adults · {new URL(product.url).searchParams.get('currency')}</p>}{item.titleSource==='link'&&<p className="fine-print">Name suggested from the link; provider details have not been verified.</p>}{item.notes&&<p className="preview-card-note">Your note: {item.notes}</p>}<p className="fine-print">{item.sourceId?'Saved from reel analysis; check the original source for its evidence.':'This saved name and link are not verified reel evidence.'} {flight?'This is a flight search, not a ticket or booking.':'Product details, price and availability still need checking.'}</p>{preferences&&<div className="saved-choice-current"><strong>{preferences.name} · selected details</strong><p>{active?.start||'Dates to decide'}{active?.end&&active.end!==active.start?' → '+active.end:''} · {preferences.adults} adults · {preferences.currency}</p>{handoff.notice&&<p>{handoff.notice}</p>}{handoff.currentUrl&&<a className="secondary preview-card-original" href={handoff.currentUrl} target="_blank" rel="noopener noreferrer">{handoff.label}<ArrowUpRight size={13}/></a>}</div>}{handoff.originalUrl&&<a className="preview-card-original" href={handoff.originalUrl} target="_blank" rel="noopener noreferrer">Open {flight?'original saved flight search':'saved provider page'}<ArrowUpRight size={13}/></a>}<InterestedButton item={item} tripId={tripId}/></article>;
}
