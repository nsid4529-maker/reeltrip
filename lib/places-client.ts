// Browser side of venue matching. Matches are batched into one request per
// bucket; venue details are fetched live when a place is opened and kept only
// in this page's memory (Google's terms do not allow storing them).
export type PlaceInput={key:string;title:string;place:string;query?:string;kind?:string;category?:string};
export type PlaceStatus='matched'|'possible'|'unmatched'|'not_a_venue'|'not_a_place'|'not_checked';
export type PlaceView={key:string;status:PlaceStatus;confidence:'high'|'medium'|'low'|'none'|'confirmed';placeId:string|null;provider:'google'|'fixture'|null;lat:number|null;lng:number|null;checkedAt:number|null;fixedBy:{id:string;name:string}|null;fixed:boolean};
export type Venue={id:string;name:string;address:string;mapsUri:string;provider:'google'|'fixture';lat:number|null;lng:number|null};
export type Candidate={id:string;name:string;address:string};

async function call<T>(path:string,init?:RequestInit,timeoutMs=15000):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
  reject(new Error('Places took too long to respond. Your reels are saved. Please try again.'));controller.abort();
 },timeoutMs);});
 const request=async()=>{
  const response=await fetch(path,{credentials:'same-origin',...init,signal:controller.signal,headers:{...(init?.body?{'Content-Type':'application/json'}:{})}});
  const data=await response.json().catch(()=>null) as (T&{error?:string})|null;
  if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Places could not be checked right now.');
  if(!data||typeof data!=='object')throw new Error('Places returned an unreadable response. Please try again.');
  return data as T;
 };
 // Bound the response body as well as fetch; a stalled phone connection must release the map.
 try{return await Promise.race([request(),deadline]);}finally{clearTimeout(timer!);}
}

type Waiting={input:PlaceInput;resolve:(view:PlaceView)=>void;reject:(error:Error)=>void};
const queues=new Map<string,{items:Waiting[];timer:ReturnType<typeof setTimeout>}>();
const known=new Map<string,Promise<PlaceView>>();
const cachePrefix=(key:string,bucketId?:string)=>(bucketId||'personal')+'|'+key+'|';
export const placeInputKey=(input:PlaceInput)=>JSON.stringify([input.key,input.title,input.place,input.query||'',input.kind||'',input.category||'']);
const cacheKey=(input:PlaceInput,bucketId?:string)=>cachePrefix(input.key,bucketId)+placeInputKey(input);
async function flush(scope:string){
 const queue=queues.get(scope);queues.delete(scope);if(!queue)return;
 const bucketId=scope==='personal'?undefined:scope;
 for(let i=0;i<queue.items.length;i+=40){
  const batch=queue.items.slice(i,i+40);
  // Three searches run together; a stale match can require both an 8s detail check and an 8s search.
  try{const {places}=await call<{places:PlaceView[]}>('/api/places/resolve',{method:'POST',body:JSON.stringify({places:batch.map(w=>w.input),...(bucketId?{bucketId}:{})})},15000+Math.ceil(batch.length/3)*16000);
   batch.forEach((w,index)=>w.resolve(places[index]));}
  catch(error){batch.forEach(w=>{known.delete(cacheKey(w.input,bucketId));w.reject(error as Error);});}
 }
}
// Places shown together are matched in one request.
export function resolvePlace(input:PlaceInput,bucketId?:string):Promise<PlaceView>{
 const id=cacheKey(input,bucketId),existing=known.get(id);if(existing)return existing;
 const scope=bucketId||'personal';
 const promise=new Promise<PlaceView>((resolve,reject)=>{
  const queue=queues.get(scope)||{items:[],timer:setTimeout(()=>void flush(scope),30)};
  queue.items.push({input,resolve,reject});queues.set(scope,queue);
 });
 known.set(id,promise);return promise;
}
export function forgetPlace(key:string,bucketId?:string){const prefix=cachePrefix(key,bucketId);for(const id of known.keys())if(id.startsWith(prefix))known.delete(id);}

const venues=new Map<string,Promise<Venue>>();
export function venue(id:string){let found=venues.get(id);if(!found){found=call<Venue>('/api/places/details?id='+encodeURIComponent(id));found.catch(()=>venues.delete(id));venues.set(id,found);}return found;}
export const searchVenues=(query:string)=>call<{candidates:Candidate[]}>('/api/places/search',{method:'POST',body:JSON.stringify({query})}).then(r=>r.candidates);
export const fixShared=(bucketId:string,key:string,change:{placeId?:string;notAPlace?:boolean;reset?:boolean})=>call<PlaceView>('/api/places/fix',{method:'POST',body:JSON.stringify({bucketId,key,...change})});

// Fixes outside a shared bucket stay on this device. Only ReelTrip's own data
// and the place id are kept, which Google's terms allow.
export const PLACE_FIXES_KEY='reeltrip-place-fixes-v1';
export type PersonalFix={placeId:string|null;provider:'google'|'fixture'|null;notAPlace:boolean;fixedAt:number};
type Store=Pick<Storage,'getItem'|'setItem'>;
export function personalFixes(storage:Pick<Storage,'getItem'>):Record<string,PersonalFix>{
 try{const value=JSON.parse(storage.getItem(PLACE_FIXES_KEY)||'{}');if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([key,fix])=>{const f=fix as PersonalFix;return key.length<=160&&f&&typeof f.notAPlace==='boolean'&&Number.isFinite(f.fixedAt)&&(f.placeId===null||(typeof f.placeId==='string'&&/^[A-Za-z0-9_-]{10,300}$/.test(f.placeId)));})) as Record<string,PersonalFix>;}
 catch{return {};}
}
export function savePersonalFix(storage:Store,key:string,fix:PersonalFix|null){
 const all=personalFixes(storage);if(fix)all[key]=fix;else delete all[key];
 storage.setItem(PLACE_FIXES_KEY,JSON.stringify(all));
}
// A personal fix overrides the automatic match on this device only.
export function withPersonalFix(view:PlaceView,fix:PersonalFix|undefined):PlaceView{
 if(!fix)return view;
 return {...view,status:fix.notAPlace?'not_a_place':'matched',confidence:'confirmed',placeId:fix.placeId,provider:fix.provider,lat:null,lng:null,checkedAt:!fix.notAPlace&&fix.placeId&&fix.provider?fix.fixedAt:null,fixedBy:{id:'me',name:'you'},fixed:true};
}

// "Last checked 3 days ago" plus the exact date for hover or long-press.
export function checkedLabel(at:number|null,now=Date.now()){
 if(!at)return null;
 const days=Math.floor((now-at)/86400000);
 const relative=days<=0?'today':days===1?'yesterday':days<30?days+' days ago':days<60?'last month':Math.floor(days/30)+' months ago';
 return {relative,exact:new Date(at).toLocaleString('en-GB',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})};
}
export const timestamp=(second:number)=>Math.floor(second/60)+':'+String(Math.floor(second%60)).padStart(2,'0');
