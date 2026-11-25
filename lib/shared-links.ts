// A share payload is untrusted text, not permission to fetch arbitrary URLs.
export function sharedLinks(params: URLSearchParams): {links:string[]; message:string} {
 const fields=['url','text','title'].map(k=>params.get(k)||'');
 if(fields.some(s=>s.length>8000))return {links:[],message:'That shared item is too long. Share an individual video link.'};
 const links:string[]=[];
 for(const field of fields)for(const raw of field.match(/https:\/\/[^\s<>"']+/gi)||[]){
  try{const u=new URL(raw.replace(/[.,;!?)\]}]+$/,''));
   if(u.username||u.password||u.port)continue;
   const host=u.hostname.toLowerCase();
   const instagram=['instagram.com','www.instagram.com'].includes(host)&&/^\/(?:p|reel|reels)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
   const tiktok=['tiktok.com','www.tiktok.com','m.tiktok.com'].includes(host)&&/^\/@[^/]+\/video\/\d+\/?$/.test(u.pathname);
   const short=['vm.tiktok.com','vt.tiktok.com'].includes(host)&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
   if(!instagram&&!tiktok&&!short)continue;
   u.search='';u.hash='';if(!links.includes(u.href))links.push(u.href);
  }catch{}
 }
 if(links.length>4)return {links:[],message:'Share up to four video links at a time.'};
 const short=links.some(s=>/^https:\/\/(vm|vt)\.tiktok\.com\//.test(s));
 return {links,message:!links.length?'No supported video link was received. Share an individual public TikTok or Instagram reel.':short?'TikTok link received. Save it to your library, then choose Plan trip.':'Video link received. Save it to your Reel Library.'};
}
