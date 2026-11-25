import {GETYOURGUIDE_PARTNER_ID,getYourGuideSearchUrl} from './booking-pages.ts';
export const AMSTERDAM_CRUISE='https://www.getyourguide.com/en-gb/amsterdam-l36/amsterdam-light-festival-heated-cruise-waffle-hot-chocolate-t907734/';
export function calendarDate(value:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function getYourGuideActivity(value:string):{url:string;id:string}|null{
 try{const u=new URL(value.trim());if(u.protocol!=='https:'||u.hostname!=='www.getyourguide.com'||u.username||u.password||u.port)return null;
 const id=u.pathname.match(/-t([1-9]\d{0,9})\/?$/)?.[1];if(!id)return null;u.search='';u.hash='';return {url:u.href,id};}catch{return null;}
}
export function getYourGuideActivityUrl(value:string,date='',adults=2):string|null{
 const activity=getYourGuideActivity(value);if(!activity)return null;
 const u=new URL(activity.url);u.searchParams.set('partner_id',GETYOURGUIDE_PARTNER_ID);u.searchParams.set('utm_medium','local_partners');u.searchParams.set('cmp','reeltrip');
 if(calendarDate(date))u.searchParams.set('date_from',date);
 if(Number.isInteger(adults)&&adults>=1&&adults<=20)u.searchParams.set('_pc','1,'+adults);
 return u.href;
}
export type ActivityInterests={boats:boolean;kids:boolean};
export function activityQuery(query:string,interests:ActivityInterests){return [query.trim(),interests.boats?'boat cruises':'',interests.kids?'family friendly':''].filter(Boolean).join(' ').slice(0,240);}
export function activitySearchUrl(query:string,interests:ActivityInterests,dateFrom='',dateTo=''){
 // These category identifiers and date parameters were observed in the provider's filters.
 const amsterdam=query.trim().toLowerCase()==='amsterdam';
 const u=new URL(amsterdam?'https://www.getyourguide.com/en-gb/amsterdam-l36/':getYourGuideSearchUrl(activityQuery(query,interests)));
 u.searchParams.set('partner_id',GETYOURGUIDE_PARTNER_ID);u.searchParams.set('cmp','reeltrip');u.searchParams.set('utm_medium','local_partners');
 if(amsterdam){const filters=[interests.boats?'tc-48':'',interests.kids?'tc-1094':''].filter(Boolean);if(filters.length)u.searchParams.set('interestFilters',filters.join(','));}
 if(calendarDate(dateFrom)){u.searchParams.set('date_from',dateFrom);if(calendarDate(dateTo)&&dateTo>=dateFrom)u.searchParams.set('date_to',dateTo);}
 return u.href;
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function getYourGuideEmbed(input:{query?:string;activityUrl?:string;currency?:string}):string{
 const activity=input.activityUrl?getYourGuideActivity(input.activityUrl):null;
 if(input.activityUrl&&!activity)throw new Error('Use a GetYourGuide activity link, not a search or an unrelated website.');
 const currency=['GBP','EUR','USD','INR'].includes(input.currency||'')?input.currency!:'GBP';
 // Currency is verified for individual availability calendars only. The
 // activities widget controls its own currency; callers disclose this limit.
 const attributes=activity?`data-gyg-href="https://widget.getyourguide.com/default/availability.frame" data-gyg-widget="availability" data-gyg-tour-id="${activity.id}" data-gyg-currency="${currency}" data-gyg-variant="horizontal"`:`data-gyg-href="https://widget.getyourguide.com/default/activities.frame" data-gyg-widget="activities" data-gyg-number-of-items="3" data-gyg-q="${escape((input.query||'').slice(0,240))}"`;
 // Official partner-builder markup. It runs only inside a sandboxed frame without
 // same-origin access, so provider scripts cannot read the guest's saved reels.
 return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px Arial,sans-serif;background:white;color:#253b34}a{color:#2f7258}</style><script async defer src="https://widget.getyourguide.com/dist/pa.umd.production.min.js" data-gyg-partner-id="${GETYOURGUIDE_PARTNER_ID}"></script></head><body><div ${attributes} data-gyg-locale-code="en-GB" data-gyg-cmp="reeltrip" data-gyg-partner-id="${GETYOURGUIDE_PARTNER_ID}"><span>Powered by <a target="_blank" rel="sponsored noopener noreferrer" href="https://www.getyourguide.com/">GetYourGuide</a></span></div></body></html>`;
}
