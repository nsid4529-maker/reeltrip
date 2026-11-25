import type {VideoAnalysis} from './analysis.ts';
import type {Interest} from './interested.ts';
import {interestUrl} from './interested.ts';
import {providerProduct} from './provider-links-save.ts';
import {calendarDate} from './getyourguide.ts';
export type ChatMessage={role:'user'|'assistant';content:string};
export const CHAT_INTEREST_LIMIT=30;
export type ChatInterest={kind:'restaurant'|'activity'|'hotel'|'flight';title:string;place:string;provider:string;url:string;notes?:string;productIdentity?:string;linkLabel?:string};
export type ChatPreferences={name:string;destination:string;dates:{start:string;end:string}[];activeDate:number;adults:number;currency:string;brief:string};
export type ChatInput={analysisIds:string[];messages:ChatMessage[];total:number;selectedInterests:ChatInterest[];preferences?:ChatPreferences};
const text=(value:unknown,max:number,empty=false):value is string=>typeof value==='string'&&value.length<=max&&(empty||!!value.trim())&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
export function selectedChatInterests(value:unknown):ChatInterest[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>CHAT_INTEREST_LIMIT)throw new Error('Choose up to 30 interested places for this conversation.');
 return value.map(item=>{
  if(!item||!['restaurant','activity','hotel','flight'].includes(item.kind)||!text(item.title,240)||!text(item.place,240,true)||(item.notes!==undefined&&!text(item.notes,600,true)))throw new Error('Invalid interested place.');
  const url=interestUrl(item.url);if(!url)throw new Error('Invalid interested link.');
  const product=providerProduct(url),u=new URL(url);
  // Provider identity is derived from a recognised product URL, never a supplied label.
  if(product&&product.kind!==item.kind)throw new Error('The interested place does not match its provider link.');
  const flight=item.kind==='flight'&&product?.kind==='flight';
  if(item.kind==='flight'&&!flight)throw new Error('Use a saved Skyscanner flight search.');
  const provider=product?.provider||(flight?'Skyscanner search':u.hostname==='www.google.com'&&u.pathname==='/maps/search/'?'Place search':'Saved website');
  return {kind:item.kind,title:item.title.trim(),place:item.place.trim(),provider,url:product?.url||url,...(product?{productIdentity:product.identity,linkLabel:product.defaultTitle}:{}),...(item.notes?{notes:item.notes.trim()}: {})};
 });
}
export const chatInterestId=(index:number)=>'saved-choice-'+(index+1);
function preferences(value:unknown):ChatPreferences|undefined{
 if(value===undefined)return undefined;
 const v=value as ChatPreferences;
 if(!v||!text(v.name,80)||!text(v.destination,160,true)||!text(v.brief,3000,true)||!Array.isArray(v.dates)||v.dates.length<1||v.dates.length>3||v.dates.some(w=>!w||![w.start,w.end].every(s=>s===''||(typeof s==='string'&&calendarDate(s))))||!Number.isInteger(v.activeDate)||v.activeDate<0||v.activeDate>=v.dates.length||!Number.isInteger(v.adults)||v.adults<1||v.adults>8||!['GBP','EUR','USD','INR'].includes(v.currency))throw new Error('Invalid trip preferences.');
 return {name:v.name,destination:v.destination,brief:v.brief,dates:v.dates.map(w=>({start:w.start,end:w.end})),activeDate:v.activeDate,adults:v.adults,currency:v.currency};
}
export function validateChat(input:unknown):ChatInput{
 const v=input as ChatInput,selectedInterests=selectedChatInterests(v?.selectedInterests);
 if(!v||!Array.isArray(v.analysisIds)||v.analysisIds.length>12||v.analysisIds.some(x=>!text(x,100))||new Set(v.analysisIds).size!==v.analysisIds.length||(!v.analysisIds.length&&!selectedInterests.length)||!Array.isArray(v.messages)||!v.messages.length||v.messages.length>12||v.messages.some(m=>!m||!['user','assistant'].includes(m.role)||!text(m.content,2000))||v.messages.at(-1)?.role!=='user'||!Number.isInteger(v.total)||v.total<v.analysisIds.length||v.total>12)throw new Error('Invalid trip conversation.');
 return {analysisIds:[...v.analysisIds],messages:v.messages.map(m=>({role:m.role,content:m.content})),total:v.total,selectedInterests,preferences:preferences(v.preferences)};
}
export function chatContext(analyses:VideoAnalysis[],selectedInterests:ChatInterest[]=[],tripPreferences?:ChatPreferences){
 const budget=Math.floor((selectedInterests.length?45000:90000)/Math.max(analyses.length,1)),encoder=new TextEncoder();
 const contexts=analyses.map(a=>{
  const context={id:a.source.id,title:a.source.title,url:a.source.source_url,creator:a.source.creator,scope:a.source.scope,context_notice:'',unknowns:a.source.unknowns.slice(0,10),practical_tips:[...(a.source.practical_tips||[])],places:a.matches.map(m=>({id:m.id,name:m.title,location:m.place,category:m.category,evidence:m.quote.slice(0,350),note:m.note?.slice(0,500),timestamp:m.second}))};
  while(encoder.encode(JSON.stringify(context)).length>budget){
   context.context_notice='Some details are omitted from this conversation context. Consult the full breakdown; do not infer missing recommendations.';
   if(context.unknowns.length>2)context.unknowns.pop();
   else if(context.places.length>8)context.places.pop();
   else if(context.practical_tips.length)context.practical_tips.pop();
   else if(context.places.length>1)context.places.pop();
   else if(context.unknowns.length)context.unknowns.pop();
   else {context.scope=context.scope.slice(0,200);for(const p of context.places){p.evidence=p.evidence.slice(0,100);p.note=p.note?.slice(0,100);}break;}
  }
  return context;
 });
 // Saved choices are a separate, explicitly labelled data object. They have no
 // reel timestamp, source URL or trusted quote, and claimed inventory is dropped.
 const saved=selectedInterests.length?[{id:'user-saved-choices',title:'USER-SAVED choices — not video evidence',scope:'The traveller explicitly selected these items. Names, locations and notes are user-supplied preferences; product identifiers come from URL parsing only. Product page contents have not been verified in this conversation. A label may suggest a feature but does not prove its presence or absence. Schedules, inclusions, exclusions, facilities, prices and availability are unknown.',places:selectedInterests.map((item,i)=>({id:chatInterestId(i),name:item.title,location:item.place,category:item.kind,provider:item.provider,product_identity:item.productIdentity,url_derived_label:item.linkLabel,evidence_type:'user_saved',name_basis:'unverified_saved_label',url_label_basis:'url_slug_only',details_verified:false,unknown_details:['schedule','duration','route','inclusions','exclusions','heating','food','drinks','facilities','accessibility','price','availability'],note:item.notes||'',availability:'unknown'}))}]:[];
 const result:Array<Record<string,unknown>>=[...contexts];
 if(saved.length&&result.length===12){
  const first=contexts[0],second=contexts[1];
  result.splice(0,2,{id:'combined-source-context',title:first.title+' / '+second.title,context_notice:'Two completed sources share this context slot. Up to 16 recommendations from each are included; consult the complete coverage summary for omitted recommendations. Each place retains its original source ID.',sources:[{id:first.id,title:first.title,url:first.url,creator:first.creator,scope:first.scope,context_notice:first.context_notice},{id:second.id,title:second.title,url:second.url,creator:second.creator,scope:second.scope,context_notice:second.context_notice}],places:[...first.places.slice(0,16).map(p=>({...p,source_id:first.id})),...second.places.slice(0,16).map(p=>({...p,source_id:second.id}))],practical_tips:[...first.practical_tips.map(t=>({...t,source_id:first.id})),...second.practical_tips.map(t=>({...t,source_id:second.id}))],unknowns:[...first.unknowns.map(note=>({source_id:first.id,note})),...second.unknowns.map(note=>({source_id:second.id,note}))]});
 }
 result.push(...saved);
 if(result.length&&tripPreferences)result[0]={...result[0],user_trip_preferences:tripPreferences};
 return result;
}
export function validateChatReply(raw:unknown,analyses:VideoAnalysis[],selectedInterests:ChatInterest[]=[],context?:Array<Record<string,unknown>>){
 const allowed=new Set(context?context.flatMap(c=>(c.places as {id:string}[]).map(p=>p.id)):[...analyses.flatMap(a=>a.matches.map(m=>m.id)),...selectedInterests.map((_,i)=>chatInterestId(i))]);
 const v=raw as {reply:string;matchIds:string[];brief:string};
 if(!v||!text(v.reply,6000)||!Array.isArray(v.matchIds)||v.matchIds.length>16||v.matchIds.some(id=>typeof id!=='string'||!allowed.has(id))||!text(v.brief,1000,true))throw new Error('The conversation response could not be verified.');
 return {reply:v.reply,matchIds:[...new Set(v.matchIds)],brief:v.brief};
}
export function conversationTopic(analyses:VideoAnalysis[],interests:Pick<Interest,'kind'>[]=[]){
 const categories=new Set([...analyses.flatMap(a=>a.matches.map(m=>m.category)),...interests.map(i=>i.kind==='restaurant'?'Food':i.kind==='activity'?'Experiences':i.kind==='hotel'?'Stays':'Transport')]);
 return categories.size===1&&categories.has('Food')?'food':categories.size===1&&categories.has('Experiences')?'activities':'mixed';
}
export function conversationQuestions(analyses:VideoAnalysis[],interests:Pick<Interest,'kind'>[]=[]){
 const topic=conversationTopic(analyses,interests);
 return topic==='food'?['Compare these cafés and restaurants','Help me shortlist places to eat','What do we need to check before reserving?']:topic==='activities'?['Compare these experiences','Suggest a relaxed activity shortlist','What do we need to check before booking?']:['What do these choices cover?','Draft a relaxed plan from my shortlist','Which details do we still need to confirm?'];
}
export function conversationKey(id:string,analyses:VideoAnalysis[],interests:ChatInterest[],prefs?:ChatPreferences,total=analyses.length){
 return JSON.stringify({id,total,sources:analyses.map(a=>({source:a.source,matches:a.matches})),interests,prefs});
}
export async function resolveChatAnalyses(ids:string[],reviewed:VideoAnalysis[],lookup:(id:string)=>Promise<VideoAnalysis|null>){
 const analyses=await Promise.all(ids.map(id=>reviewed.find(a=>a.source.id===id)||lookup(id)));
 if(analyses.some(a=>!a))throw new Error('A breakdown has expired. Refresh the reel analysis before continuing this conversation.');
 return analyses as VideoAnalysis[];
}
