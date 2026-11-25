import {uploadReference} from './uploaded-reel.ts';
export type ReelPreviewSource={url:string;embed:string|null;platform:'Instagram'|'TikTok'|'Uploaded video'};
// Construct the player from a validated post identity. Never embed user HTML,
// arbitrary URLs, query parameters or a provider's returned script.
export function reelPreviewSource(raw:string):ReelPreviewSource|null{
 if(typeof raw!=='string'||raw.length>1000)return null;
 const upload=uploadReference(raw);if(upload)return {platform:'Uploaded video',url:upload.url,embed:null};
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  if(['instagram.com','www.instagram.com'].includes(u.hostname)){
   const id=u.pathname.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]{1,100})\/?$/)?.[1];
   return id?{platform:'Instagram',url:`https://www.instagram.com/p/${id}/`,embed:`https://www.instagram.com/p/${id}/embed/`}:null;
  }
  if(['tiktok.com','www.tiktok.com','m.tiktok.com'].includes(u.hostname)){
   const match=u.pathname.match(/^\/@([A-Za-z0-9_.-]{1,100})\/video\/(\d{1,25})\/?$/);
   return match?{platform:'TikTok',url:`https://www.tiktok.com/@${match[1]}/video/${match[2]}`,embed:`https://www.tiktok.com/player/v1/${match[2]}?autoplay=0&description=1`}:null;
  }
  if(['vm.tiktok.com','vt.tiktok.com'].includes(u.hostname)&&/^\/[A-Za-z0-9_-]{1,100}\/?$/.test(u.pathname))return {platform:'TikTok',url:u.origin+u.pathname,embed:null};
 }catch{}
 return null;
}
