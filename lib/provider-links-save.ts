import {calendarDate,getYourGuideActivityUrl} from './getyourguide.ts';

export type ProviderPlaceKind='activity'|'hotel'|'restaurant'|'flight';
export type ProviderProduct={kind:ProviderPlaceKind;provider:string;url:string;identity:string;defaultTitle:string};

// A readable URL slug is a proposed label, not verified provider metadata.
function slugName(slug:string,fallback:string):string {
 try {
  const name=decodeURIComponent(slug).replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
  if(!name||name.length>240||/[\u0000-\u001f\u007f<>]/.test(name))return fallback;
  return name.replace(/(^|\s)\p{L}/gu,letter=>letter.toUpperCase());
 }catch{return fallback;}
}

function flightProduct(u:URL):ProviderProduct|null {
 const path=u.pathname.match(/^\/transport\/flights\/([a-z]{3})\/([a-z]{3})\/(\d{6})\/(\d{6})\/?$/i);
 if(!path||path[1].toLowerCase()===path[2].toLowerCase())return null;
 const date=(value:string)=>'20'+value.slice(0,2)+'-'+value.slice(2,4)+'-'+value.slice(4,6);
 const start=date(path[3]),end=date(path[4]);
 if(!calendarDate(start)||!calendarDate(end)||end<=start)return null;
 for(const key of ['adultsv2','currency','cabinclass','departure-times','preferdirects','outboundaltsenabled','inboundaltsenabled','rtn'])if(u.searchParams.getAll(key).length>1)return null;
 const adults=u.searchParams.get('adultsv2'),currency=u.searchParams.get('currency'),cabin=u.searchParams.get('cabinclass');
 if(!adults||!/^[1-8]$/.test(adults)||!currency||!['GBP','EUR','USD','INR'].includes(currency)||!cabin||!['economy','premiumeconomy','business','first'].includes(cabin))return null;
 for(const key of ['preferdirects','outboundaltsenabled','inboundaltsenabled'])if(u.searchParams.has(key)&&!['true','false'].includes(u.searchParams.get(key)!))return null;
 if(u.searchParams.has('rtn')&&u.searchParams.get('rtn')!=='1')return null;
 const departure=u.searchParams.get('departure-times');
 if(departure!==null&&!/^(\d{1,4})-(\d{1,4}),(\d{1,4})-(\d{1,4})$/.test(departure))return null;
 if(departure!==null&&departure.split(',').some(range=>{const [a,b]=range.split('-').map(Number);return a<0||b>1439||a>=b;}))return null;
 const url=new URL('https://www.skyscanner.net'+u.pathname.toLowerCase().replace(/\/?$/,'/'));
 url.searchParams.set('adultsv2',adults);url.searchParams.set('cabinclass',cabin);url.searchParams.set('currency',currency);
 for(const key of ['rtn','preferdirects','outboundaltsenabled','inboundaltsenabled'])if(u.searchParams.has(key))url.searchParams.set(key,u.searchParams.get(key)!);
 if(departure!==null)url.searchParams.set('departure-times',departure);
 return {kind:'flight',provider:'Skyscanner',url:url.href,identity:'flight:skyscanner:'+url.pathname+url.search,defaultTitle:`${path[1].toUpperCase()} → ${path[2].toUpperCase()} · ${start} to ${end}`};
}

// Shared links are untrusted. Only full, specific product pages are bookmarks;
// city/search pages and redirect links cannot identify a particular place.
export function providerProduct(value:unknown):ProviderProduct|null {
 if(typeof value!=='string'||value.length>2048)return null;
 const raw=value.trim();
 if(!raw||/[\u0000-\u0020\u007f\\]/.test(raw))return null;
 try {
  const u=new URL(raw),host=u.hostname.toLowerCase().replace(/^www\./,''),path=u.pathname;
  if(u.protocol!=='https:'||u.username||u.password||u.port||/%(?:2f|5c|00|0[ad])/i.test(path))return null;
  if(host==='skyscanner.net')return flightProduct(u);
  let kind:ProviderPlaceKind,provider:string,identity:string,title:string;
  let match:RegExpMatchArray|null;
  if(host==='viator.com'&&(match=path.match(/^\/tours\/[A-Za-z0-9%_/-]+\/d\d+-([A-Za-z0-9_]+)\/?$/))){
   kind='activity';provider='Viator';identity='activity:viator:'+match[1];title=slugName(path.replace(/\/$/,'').split('/').at(-2)||'','Viator activity '+match[1]);
  } else if(host==='getyourguide.com'&&(match=path.match(/^\/(?:[A-Za-z0-9%_-]+\/)*[A-Za-z0-9%_-]+-t([1-9]\d{0,9})\/?$/))){
   kind='activity';provider='GetYourGuide';identity='activity:getyourguide:'+match[1];title=slugName(path.replace(/\/$/,'').split('/').at(-1)!.replace(/-t\d+$/,''),'GetYourGuide activity '+match[1]);
  } else if(host==='booking.com'&&(match=path.match(/^\/hotel\/([a-z]{2})\/([A-Za-z0-9_-]+)(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.html\/?$/i))){
   kind='hotel';provider='Booking.com';identity='hotel:booking:'+match[1].toLowerCase()+':'+match[2].toLowerCase();title=slugName(match[2],'Saved Booking.com hotel');
  } else if((host==='airbnb.com'||host==='airbnb.co.uk')&&(match=path.match(/^\/rooms\/([1-9]\d{0,23})\/?$/))){
   kind='hotel';provider='Airbnb';identity='hotel:airbnb:'+match[1];title='Airbnb stay '+match[1];
   u.hostname='www.airbnb.com';u.pathname='/rooms/'+match[1];u.search='';u.hash='';
   return {kind,provider,url:u.href,identity,defaultTitle:title};
  } else if((host==='expedia.com'||host==='expedia.co.uk')&&(match=path.match(/^\/[A-Za-z0-9%_-]+\.h([1-9]\d*)\.Hotel-Information\/?$/))){
   kind='hotel';provider='Expedia';identity='hotel:expedia:'+match[1];title=slugName(path.slice(1).replace(/\.h\d+\.Hotel-Information\/?$/,''),'Saved Expedia hotel');
  } else if((host==='opentable.com'||host==='opentable.co.uk')&&/^\/r\/[A-Za-z0-9_-]+\/?$/.test(path)){
   kind='restaurant';provider='OpenTable';identity='restaurant:www.'+host+path.replace(/\/$/,'');title=slugName(path.replace(/\/$/,'').split('/').at(-1)!,'Saved OpenTable restaurant');
  } else if(host==='sevenrooms.com'&&/^\/explore\/[A-Za-z0-9_-]+\/reservations\/create\/search\/?$/.test(path)){
   kind='restaurant';provider='SevenRooms';identity='restaurant:www.'+host+path.replace(/\/$/,'');title=slugName(path.split('/')[2],'Saved SevenRooms restaurant');
  } else return null;
  u.hostname='www.'+host;u.pathname=path.replace(/\/$/,'');u.search='';u.hash='';
  const url=provider==='GetYourGuide'?getYourGuideActivityUrl(u.href):u.href;
  return url?{kind,provider,url,identity,defaultTitle:title}:null;
 } catch {return null;}
}
