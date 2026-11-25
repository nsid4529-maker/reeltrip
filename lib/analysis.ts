import {canonicalKey,type Match} from './travel.ts';
import {uploadReference} from './uploaded-reel.ts';
export type PracticalTip={subject:string;topic:'Timing'|'Transport'|'Tickets'|'Stay length'|'Route'|'Other';details:string;quote:string;time_seconds:number[];basis:string};
export type VideoSource={id:string;platform:string;source_url:string;creator:string;scope:string;title:string;analysis_kind?:'ai';method?:{date:string};days:{day:number;items:{details:string;time_seconds:number[]}[]}[];unknowns:string[];practical_tips?:PracticalTip[]};
export type VideoAnalysis={source:VideoSource;matches:Match[]};
export type ExtractClip={status:string;source?:VideoSource;matches?:Match[];jobId?:string;stage?:string;message?:string};
const text=(v:unknown,max=2000):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function sourceMatchesURL(sourceURL:string,requestedURL:string):boolean {
 const uploaded=uploadReference(requestedURL);if(uploaded)return uploadReference(sourceURL)?.id===uploaded.id;
 try { return canonicalKey(sourceURL)===canonicalKey(requestedURL); } catch {
  // Only the authenticated processor resolves these allowlisted short links.
  try {const u=new URL(requestedURL);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['vm.tiktok.com','vt.tiktok.com'].includes(u.hostname)&&/^\/[\w-]+\/?$/.test(u.pathname)&&canonicalKey(sourceURL).startsWith('tiktok-');}catch{return false;}
 }
}
export function validateAnalysis(value:unknown,requestedURL:string):VideoAnalysis{
 const v=value as VideoAnalysis,s=v?.source;
 if(!s||!text(s.id,100)||!text(s.source_url,1000)||!sourceMatchesURL(s.source_url,requestedURL)||!(uploadReference(requestedURL)?s.platform==='Uploaded video':['Instagram','TikTok'].includes(s.platform))||s.analysis_kind!=='ai'||!text(s.title,200)||!text(s.creator,100)||!text(s.scope,1000))throw new Error('Analysis source could not be verified.');
 if(!Array.isArray(s.days)||s.days.length>32||s.days.some(d=>!Number.isInteger(d.day)||d.day<0||!Array.isArray(d.items)||d.items.length>32||d.items.some(i=>!text(i.details)||!Array.isArray(i.time_seconds)||i.time_seconds.length!==2||i.time_seconds.some(n=>!Number.isFinite(n)||n<0||n>180)||i.time_seconds[1]<i.time_seconds[0]))||s.days.reduce((n,d)=>n+d.items.length,0)>32)throw new Error('Invalid video evidence.');
 if(!Array.isArray(s.unknowns)||s.unknowns.length>40||s.unknowns.some(x=>!text(x,1000))||!Array.isArray(v.matches)||v.matches.length>32)throw new Error('Invalid analysis details.');
 const tips=s.practical_tips??[];
 if(!Array.isArray(tips)||tips.length>24||tips.some(t=>!t||!text(t.subject,180)||!text(t.details,700)||!text(t.quote,350)||!['Timing','Transport','Tickets','Stay length','Route','Other'].includes(t.topic)||!['speech','caption','screen_text'].includes(t.basis)||!Array.isArray(t.time_seconds)||t.time_seconds.length!==2||t.time_seconds.some(n=>!Number.isFinite(n)||n<0||n>180)||t.time_seconds[1]<t.time_seconds[0]))throw new Error('Invalid practical travel advice.');
 const clean=v.matches.map(m=>{
  if(!m||!text(m.id,100)||m.source!==s.id||!text(m.title,200)||!text(m.place,200)||!text(m.query,400)||!text(m.kind,100)||!text(m.quote)||!['Food','Stays','Experiences','Transport'].includes(m.category)||!Number.isFinite(m.second)||m.second<0||m.second>180)throw new Error('Invalid place evidence.');
  // Providers and URLs are chosen by ReelTrip, never supplied by model output.
  const providers=m.category==='Food'?['OpenTable']:m.category==='Stays'?['Booking.com']:['Viator','GetYourGuide'];
  return {id:m.id,source:m.source,title:m.title,place:m.place,category:m.category,kind:'AI-identified · confirm the name',query:m.query,quote:m.quote,second:m.second,providers,note:text(m.note)?m.note:'Confirm the name and location against the original reel.'};
 });
 if(new Set(clean.map(m=>m.id)).size!==clean.length)throw new Error('Duplicate place identifiers.');
 return {source:{id:s.id,platform:s.platform,source_url:s.source_url,creator:s.creator,scope:s.scope,title:s.title,analysis_kind:'ai',days:s.days,unknowns:s.unknowns,practical_tips:tips},matches:clean};
}
