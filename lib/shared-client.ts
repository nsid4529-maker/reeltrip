// Browser side of shared buckets: small typed calls to /api/shared and
// /api/members. Errors come back as readable messages from the server.
export type SharedRole='owner'|'editor';
export type SharedPlace={id:string;title:string;place:string;category:string;quote:string;second:number;kind?:string;query?:string;up:number;down:number;myVote:number};
export type SharedReel={id:string;key:string;url:string;addedBy:{id:string;name:string};addedAt:number;status:'ready'|'analysing'|'not_travel'|'unavailable';title:string;creator:string;platform:string;message:string;omittedDetails?:number;places:SharedPlace[];canRemove:boolean};
export type SharedBucket={id:string;name:string;updatedAt:number;me:{id:string;name:string;role:SharedRole};members:{id:string;name:string;role:SharedRole}[];maxMembers:number;reels:SharedReel[];trip:{start:string|null;end:string|null;travellers:number;travellersSet:boolean};shortlist:{by:{id:string;name:string};at:number}|null;invites:{id:string;expiresAt:number;canRevoke:boolean}[]};
export type SharedSummary={id:string;name:string;role:SharedRole;members:number;reels:number;updatedAt:number};
export type InvitePreview={bucketName:string;ownerName:string;members:number;maxMembers:number;full:boolean;me:{name:string}|null;alreadyMember:boolean;bucketId?:string};
export class SharedError extends Error{status:number;bucketMayExist:boolean;constructor(message:string,status:number,bucketMayExist=false){super(message);this.status=status;this.bucketMayExist=bucketMayExist;}}

async function call<T>(path:string,method='GET',body?:unknown,timeoutMs=30000):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
  reject(new SharedError('The connection took too long. Your last change may already be saved. Refresh before trying again.',408));controller.abort();
 },timeoutMs);});
 const request=async()=>{
  let response:Response;
  try{response=await fetch(path,{method,credentials:'same-origin',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw new SharedError('You seem to be offline. Check your connection and try again.',0);}
  const data=await response.json().catch(()=>null) as (T&{error?:string})|null;
  if(!response.ok)throw new SharedError(typeof data?.error==='string'?data.error:'Something went wrong. Please try again.',response.status);
  if(!data||typeof data!=='object')throw new SharedError('ReelTrip returned an unreadable response. Refresh before trying again.',502);
  return data as T;
 };
 // Bound body reads too; a stalled mobile connection must not keep controls busy.
 try{return await Promise.race([request(),deadline]);}finally{clearTimeout(timer!);}
}
export const me=async():Promise<{id:string;name:string}|null>=>{try{return await call('/api/members/me');}catch(e){if(e instanceof SharedError&&e.status===401)return null;throw e;}};
export const becomeMember=(name:string)=>call<{id:string;name:string}>('/api/members','POST',{name});
export const listShared=()=>call<{buckets:SharedSummary[]}>('/api/shared').then(r=>r.buckets);
export async function createShared(name:string,reelUrls:string[]):Promise<{id:string;name:string;skipped:number}>{
 // Imports run sequentially; each can check an old job then submit once (15s each).
 try{return await call('/api/shared','POST',{name,reelUrls},30000+Math.min(reelUrls.length,12)*30000);}
 catch(error){
  if(error instanceof SharedError&&(error.status===0||error.status===408||error.status>=500))throw new SharedError('Your shared bucket may already have been created. Check your shared buckets before creating another.',error.status,true);
  throw error;
 }
}
// A bucket read refreshes up to four processor jobs sequentially, at 15s each.
export const getShared=(id:string)=>call<SharedBucket>('/api/shared/bucket?id='+encodeURIComponent(id),'GET',undefined,90000);
export const createInvite=(bucketId:string)=>call<{id:string;token:string;expiresAt:number}>('/api/shared/invites','POST',{bucketId});
export const revokeInvite=(bucketId:string,inviteId:string)=>call('/api/shared/invites','DELETE',{bucketId,inviteId});
export const previewInvite=(token:string)=>call<InvitePreview>('/api/shared/join','POST',{token,preview:true});
export const joinShared=(token:string,name?:string)=>call<{bucketId:string;joined:boolean;member:{id:string;name:string}}>('/api/shared/join','POST',{token,...(name?{name}:{})});
export const addSharedReel=(bucketId:string,url:string,refresh=false)=>call<{id:string;added:boolean}>('/api/shared/reels','POST',{bucketId,url,...(refresh?{refresh:true}:{})},45000);
export const removeSharedReel=(bucketId:string,reelId:string)=>call('/api/shared/reels','DELETE',{bucketId,reelId});
export const setSharedTrip=(bucketId:string,trip:{start:string;end:string;travellers:number|null})=>call('/api/shared/trip','POST',{bucketId,...trip});
export const setShortlistAgreed=(bucketId:string,agreed:boolean)=>call('/api/shared/shortlist','POST',{bucketId,agreed});
export const deleteShared=(bucketId:string)=>call<{deleted:boolean}>('/api/shared/bucket','DELETE',{bucketId});
export const voteShared=(bucketId:string,placeKey:string,value:1|-1|0)=>call('/api/shared/votes','POST',{bucketId,placeKey,value});

// The token goes in the fragment (#), so it never reaches server logs or Referer headers.
export const inviteLink=(origin:string,token:string)=>origin+'/join#'+token;
export const tokenFromHash=(hash:string)=>{const token=hash.replace(/^#/,'');return /^[0-9a-f]{64}$/.test(token)?token:null;};

// Remembers which personal bucket was shared as which shared bucket, on this device.
export const SHARED_LINKS_KEY='reeltrip-shared-buckets-v1';
export function sharedFor(storage:Pick<Storage,'getItem'>,tripId:string):string|null{
 try{const value=JSON.parse(storage.getItem(SHARED_LINKS_KEY)||'{}');const id=value?.[tripId];return typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id)?id:null;}catch{return null;}
}
export function rememberShared(storage:Pick<Storage,'getItem'|'setItem'>,tripId:string,sharedId:string){
 let value:unknown={};try{value=JSON.parse(storage.getItem(SHARED_LINKS_KEY)||'{}');}catch{/* Damaged shortcuts are replaced; the buckets themselves live on the server. */}
 try{storage.setItem(SHARED_LINKS_KEY,JSON.stringify({...(value&&typeof value==='object'&&!Array.isArray(value)?value:{}),[tripId]:sharedId}));}catch{/* The shared bucket still exists; only this shortcut is lost. */}
}
