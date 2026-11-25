import type {ChatMessage} from './bundle-chat.ts';

export type ChatSession={messages:ChatMessage[];question:string;suggestion:{brief:string;matchIds:string[]}|null};
const MAX_CONTEXT=1_000_000,MAX_STORED=1_100_000;
const damaged='This saved conversation could not be read. Its existing data has been kept unchanged.';
const empty=():ChatSession=>({messages:[],question:'',suggestion:null});
const text=(value:unknown,max:number,allowEmpty=false):value is string=>typeof value==='string'&&value.length<=max&&(allowEmpty||!!value.trim())&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
export function chatSessionStorageKey(tripId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tripId))throw new Error('A valid bucket is required to save this conversation.');
 return 'reeltrip-bucket-chat-v1:'+tripId.toLowerCase();
}
function parse(raw:string){
 if(raw.length>MAX_STORED)throw new Error(damaged);
 const value=JSON.parse(raw);
 if(!value||value.version!==1||!text(value.context,MAX_CONTEXT)||!Array.isArray(value.messages)||value.messages.length>12||value.messages.some((m:ChatMessage)=>!m||!['user','assistant'].includes(m.role)||!text(m.content,m.role==='user'?2000:6000))||!text(value.question,2000,true))throw new Error(damaged);
 const suggestion=value.suggestion;
 if(suggestion!==null&&(!suggestion||!text(suggestion.brief,1000,true)||!Array.isArray(suggestion.matchIds)||suggestion.matchIds.length>16||suggestion.matchIds.some((id:unknown)=>!text(id,100))||new Set(suggestion.matchIds).size!==suggestion.matchIds.length))throw new Error(damaged);
 return {context:value.context as string,messages:value.messages.map((m:ChatMessage)=>({role:m.role,content:m.content})),question:value.question as string,suggestion:suggestion===null?null:{brief:suggestion.brief as string,matchIds:[...suggestion.matchIds] as string[]}};
}
export function readChatSession(raw:string|null,context:string,allowedIds:readonly string[]):ChatSession{
 if(raw===null)return empty();
 try{
  const value=parse(raw);
  if(value.context!==context)return empty();
  if(value.suggestion?.matchIds.some(id=>!allowedIds.includes(id)))throw new Error(damaged);
  return {messages:value.messages,question:value.question,suggestion:value.suggestion};
 }catch{throw new Error(damaged);}
}
export function writeChatSession(storage:Pick<Storage,'getItem'|'setItem'>,tripId:string,context:string,state:ChatSession,allowedIds:readonly string[]){
 const key=chatSessionStorageKey(tripId),existing=storage.getItem(key);
 if(existing!==null)readChatSession(existing,context,allowedIds);
 if(!text(context,MAX_CONTEXT))throw new Error('This conversation is too large to save in this tab. It remains available while this page is open.');
 const raw=JSON.stringify({version:1,context,messages:state.messages,question:state.question,suggestion:state.suggestion});
 readChatSession(raw,context,allowedIds);storage.setItem(key,raw);
}
export function requestChatHistory(messages:ChatMessage[],question:string):ChatMessage[]{
 return [...messages,{role:'user' as const,content:question.trim()}].slice(-11).map(message=>({...message,content:message.content.slice(0,2000)}));
}
