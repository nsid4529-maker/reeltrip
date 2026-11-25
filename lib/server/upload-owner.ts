import {ServiceError} from './http-safety.ts';

const COOKIE='reeltrip_upload_owner';
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
async function signature(secret:string,value:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));
}
export async function uploadOwner(request:Request,secret:string,create=false):Promise<{owner:string;cookie?:string}>{
 if(secret.length<32)throw new ServiceError('Private video uploads are temporarily unavailable.');
 const values=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(COOKIE+'='));
 const match=values.length===1?values[0].slice(COOKIE.length+1).match(/^v1\.([0-9a-f]{64})\.([0-9a-f]{64})$/):null;
 let nonce='';
 if(match){
  const expected=await signature(secret,'reeltrip-upload-cookie:'+match[1]);
  let difference=0;for(let index=0;index<64;index++)difference|=expected.charCodeAt(index)^match[2].charCodeAt(index);
  if(difference===0)nonce=match[1];
 }
 let cookie:string|undefined;
 if(!nonce){
  if(!create)throw new ServiceError('This upload is unavailable in this browser. Please upload the video again.',404);
  nonce=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  cookie=`${COOKIE}=v1.${nonce}.${await signature(secret,'reeltrip-upload-cookie:'+nonce)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}`;
 }
 return {owner:await signature(secret,'reeltrip-upload-owner:'+nonce),...(cookie?{cookie}:{})};
}
