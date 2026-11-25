import {ServiceError} from './http-safety.ts';
import {createMember,currentMember,hashToken,memberName,type Member} from './members.ts';
import {analyseLink,normaliseLink} from './analyse-link.ts';
import {pollAnalysis} from './processing.ts';
import {reelID} from '../reel-library.ts';
import type {LinkClip} from './extract-links.ts';

// Shared buckets: 2–6 members fill one server-side bucket from their own
// phones. Every read and write checks membership first, and a non-member gets
// the same 404 as a bucket that does not exist, so ids reveal nothing.
export const MAX_MEMBERS=6,MAX_REELS=50,MAX_OWNED=20,MAX_ACTIVE_INVITES=10,INVITE_DAYS=14;
const DAY=86400000,REFRESH_MS=5000,REFRESH_PER_READ=1,POLL_LEASE_MS=40000;
type Row=Record<string,unknown>;
type Statement={first<T=Row>():Promise<T|null>;all<T=Row>():Promise<{results:T[]}>;run():Promise<unknown>};
export type Database={prepare(query:string):{bind(...values:unknown[]):Statement}};
export type Role='owner'|'editor';
export type PlaceSnapshot={id:string;title:string;place:string;category:string;quote:string;second:number;kind?:string;query?:string};
export type ReelSnapshot={source:{id:string;title:string;creator:string;platform:string;source_url:string};places:PlaceSnapshot[];omittedDetails?:number};
export type ReelStatus='ready'|'analysing'|'not_travel'|'unavailable';
type AnalysisOutcome={status:ReelStatus;jobId:string|null;analysis:string|null};

const notFound=()=>new ServiceError('This shared bucket was not found, or you are not a member of it.',404);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const clip=(value:unknown,max:number)=>typeof value==='string'?value.slice(0,max):'';

export function bucketName(value:unknown):string{
 const name=typeof value==='string'?value.trim():'';
 if(!name||name.length>80||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))throw new ServiceError('Name the bucket in 1–80 characters.',400);
 return name;
}
export async function requireMember(db:Database,req:Request):Promise<Member>{
 const member=await currentMember(db,req);
 if(!member)throw new ServiceError('Add your name on this device first.',401);
 return member;
}
export async function roleIn(db:Database,bucketId:unknown,memberId:string):Promise<Role>{
 if(!uuid(bucketId))throw notFound();
 const row=await db.prepare('SELECT role FROM bucket_members WHERE bucket_id=? AND member_id=?').bind(bucketId,memberId).first<{role:Role}>();
 if(!row)throw notFound();
 return row.role;
}
const touch=(db:Database,bucketId:string)=>db.prepare('UPDATE shared_buckets SET updated_at=? WHERE id=?').bind(Date.now(),bucketId).run();

// Keep only what the shared view needs; it is derived on the server, never sent by a client.
export function snapshot(result:LinkClip):ReelSnapshot|null{
 const source=result.source as Row|undefined,matches=result.matches as Row[]|undefined;
 if(!source||!Array.isArray(matches))return null;
 const omissions=Array.isArray(source.unknowns)?source.unknowns.map(value=>typeof value==='string'?Number(value.match(/^Partial breakdown: (\d{1,3}) detail\(s\)/)?.[1]||0):0):[];
 const omittedDetails=Math.max(0,...omissions);
 return {source:{id:clip(source.id,120),title:clip(source.title,200),creator:clip(source.creator,100),platform:clip(source.platform,40),source_url:clip(source.source_url,1000)},
  ...(omittedDetails?{omittedDetails}:{}),
  places:matches.slice(0,40).filter(m=>typeof m?.id==='string').map(m=>({id:clip(m.id,160),title:clip(m.title,200),place:clip(m.place,200),category:clip(m.category,40),quote:clip(m.quote,300),second:Number.isFinite(m.second)?Number(m.second):0,kind:clip(m.kind,100),query:clip(m.query,400)}))};
}
function outcome(result:LinkClip):AnalysisOutcome{
 if(result.status==='analysis_completed'||result.status==='analysis_cached'){const snap=snapshot(result);if(snap)return {status:'ready',jobId:null,analysis:JSON.stringify(snap)};}
 if((result.status==='queued'||result.status==='processing')&&uuid(result.jobId))return {status:'analysing',jobId:result.jobId as string,analysis:null};
 const message=clip(result.message,300)||'This reel could not be analysed yet.';
 return {status:result.status==='not_travel'||result.status==='reference_reviewed'?'not_travel':'unavailable',jobId:null,analysis:JSON.stringify({message})};
}
// A refresh must not discard usable saved places or move their votes to a different venue.
function retainPrevious(previous:string|null,next:AnalysisOutcome):AnalysisOutcome{
 let old:ReelSnapshot;try{old=JSON.parse(previous||'null');}catch{return next;}
 if(!old?.source||!Array.isArray(old.places)||!old.places.length||next.status==='not_travel')return next;
 const updated=next.analysis?JSON.parse(next.analysis):null;
 if(next.status==='ready'&&updated?.places?.length){
  const available=[...old.places];
  const places=updated.places.map((p:PlaceSnapshot)=>{
   const index=available.findIndex(old=>old.title===p.title&&old.place===p.place&&old.category===p.category&&old.quote===p.quote);
   const id=index>=0?available.splice(index,1)[0].id:'shared-'+crypto.randomUUID();
   return {...p,id};
  });
  return {...next,analysis:JSON.stringify({...updated,places})};
 }
 const message=next.status==='analysing'?'Checking this reel again. Your saved places are still shown.':next.status==='ready'?'The new analysis could not confirm any places. Your previous places are still shown; check the original reel.':'We couldn’t update this reel. Your saved places are still shown.'+(updated?.message?' '+clip(updated.message,300):'');
 return {...next,status:next.status==='analysing'?'analysing':'ready',analysis:JSON.stringify({...old,message})};
}
async function clearRemovedPlaces(db:Database,bucketId:string,previous:string|null,next:string|null){
 let removed:string[];
 try{const current=new Set((JSON.parse(next||'{}').places||[]).map((p:PlaceSnapshot)=>p.id));removed=(JSON.parse(previous||'{}').places||[]).map((p:PlaceSnapshot)=>p.id).filter((id:string)=>!current.has(id));}catch{return;}
 if(!removed.length)return;
 // Check current references in the delete itself: another request may have re-added the place.
 for(const key of new Set(removed))for(const [table,scope] of [['place_votes','bucket_id'],['place_resolutions','scope']]){
  await db.prepare(`DELETE FROM ${table} WHERE ${scope}=? AND place_key=? AND NOT EXISTS (SELECT 1 FROM bucket_reels r,json_each(CASE WHEN json_valid(r.analysis) THEN r.analysis ELSE '{}' END,'$.places') p WHERE r.bucket_id=? AND CASE WHEN p.type='object' THEN json_extract(p.value,'$.id') END=?)`).bind(bucketId,key,bucketId,key).run();
 }
}
async function analyse(req:Request,url:string){
 try{return outcome(await analyseLink(req,url));}
 catch(error){
  // The reel is still added; any member can try the analysis again later.
  const message=error instanceof ServiceError?error.message:'Analysis could not be started. Try again later.';
  return {status:'unavailable' as ReelStatus,jobId:null,analysis:JSON.stringify({message})};
 }
}

export async function createSharedBucket(db:Database,req:Request,member:Member,input:{name?:unknown;reelUrls?:unknown}){
 const name=bucketName(input.name);
 const urls=input.reelUrls===undefined?[]:input.reelUrls;
 if(!Array.isArray(urls)||urls.length>12||urls.some(u=>typeof u!=='string'||u.length>1000))throw new ServiceError('Bring up to 12 reel links into a shared bucket.',400);
 const owned=await db.prepare("SELECT count(*) AS n FROM bucket_members WHERE member_id=? AND role='owner'").bind(member.id).first<{n:number}>();
 if((owned?.n||0)>=MAX_OWNED)throw new ServiceError('You can own up to 20 shared buckets.',409);
 const id=crypto.randomUUID(),now=Date.now();
 await db.prepare('INSERT INTO shared_buckets (id,name,owner_member_id,created_at,updated_at) VALUES (?,?,?,?,?)').bind(id,name,member.id,now,now).run();
 await db.prepare("INSERT INTO bucket_members (bucket_id,member_id,role,joined_at) VALUES (?,?,'owner',?)").bind(id,member.id,now).run();
 // Uploaded videos are private to one browser and links that are not reels are skipped.
 let skipped=0;
 for(const raw of urls as string[]){const url=normaliseLink(raw);if(!url){skipped++;continue;}await addReel(db,req,member,id,url);}
 return {id,name,skipped};
}

export async function listBuckets(db:Database,member:Member){
 const {results}=await db.prepare(`SELECT b.id,b.name,b.updated_at,m.role,
  (SELECT count(*) FROM bucket_members x WHERE x.bucket_id=b.id) AS members,
  (SELECT count(*) FROM bucket_reels r WHERE r.bucket_id=b.id) AS reels
  FROM bucket_members m JOIN shared_buckets b ON b.id=m.bucket_id WHERE m.member_id=? ORDER BY b.updated_at DESC LIMIT 50`).bind(member.id).all<{id:string;name:string;updated_at:number;role:Role;members:number;reels:number}>();
 return results.map(r=>({id:r.id,name:r.name,role:r.role,members:r.members,reels:r.reels,updatedAt:r.updated_at}));
}

// One oldest job per 5 s across all viewers: the same ceiling as four jobs per 20 s.
async function refreshPending(db:Database,req:Request,bucketId:string){
 const {results}=await db.prepare("SELECT id,job_id,analysis,checked_at FROM bucket_reels WHERE bucket_id=? AND status='analysing' AND job_id IS NOT NULL AND checked_at<=? ORDER BY checked_at LIMIT ?").bind(bucketId,Date.now()-REFRESH_MS,REFRESH_PER_READ).all<{id:string;job_id:string;analysis:string|null;checked_at:number}>();
 for(const row of results){
  const now=Date.now(),claimAt=now+POLL_LEASE_MS-REFRESH_MS;
  // The timestamp lease prevents duplicate polls; an interrupted request becomes retryable on its own.
  const claimed=await db.prepare("UPDATE bucket_reels SET checked_at=? WHERE id=? AND bucket_id=? AND status='analysing' AND job_id=? AND checked_at=? AND analysis IS ? AND NOT EXISTS (SELECT 1 FROM bucket_reels WHERE bucket_id=? AND checked_at>?) RETURNING id").bind(claimAt,row.id,bucketId,row.job_id,row.checked_at,row.analysis,bucketId,now-REFRESH_MS).first();
  if(!claimed)continue;
  let next:AnalysisOutcome|null=null;
  try{next=outcome(await pollAnalysis(req,row.job_id) as LinkClip);}
  catch(error){if(error instanceof ServiceError&&error.status===404)next={status:'unavailable',jobId:null,analysis:JSON.stringify({message:'This analysis expired. Try it again.'})};}
  if(next){
   next=retainPrevious(row.analysis,next);
   // Another viewer may have finished this job, refreshed it again, or removed it while we polled.
   const applied=await db.prepare("UPDATE bucket_reels SET status=?,job_id=?,analysis=?,checked_at=? WHERE id=? AND bucket_id=? AND status='analysing' AND job_id=? AND checked_at=? AND analysis IS ? RETURNING id").bind(next.status,next.jobId,next.analysis,Date.now(),row.id,bucketId,row.job_id,claimAt,row.analysis).first();
   if(applied)await clearRemovedPlaces(db,bucketId,row.analysis,next.analysis);
  }
  else await db.prepare("UPDATE bucket_reels SET checked_at=? WHERE id=? AND bucket_id=? AND status='analysing' AND job_id=? AND checked_at=? AND analysis IS ?").bind(Date.now(),row.id,bucketId,row.job_id,claimAt,row.analysis).run();
 }
}

export async function getBucket(db:Database,req:Request,member:Member,bucketId:unknown){
 const role=await roleIn(db,bucketId,member.id),id=bucketId as string;
 try{await refreshPending(db,req,id);}catch{/* Showing the bucket matters more than a progress check. */}
 const bucket=await db.prepare('SELECT b.id,b.name,b.owner_member_id,b.updated_at,b.trip_start,b.trip_end,b.travellers,b.shortlist_agreed_by,b.shortlist_agreed_at,m.display_name AS agreed_name FROM shared_buckets b LEFT JOIN members m ON m.id=b.shortlist_agreed_by WHERE b.id=?').bind(id).first<{id:string;name:string;owner_member_id:string;updated_at:number;trip_start:string|null;trip_end:string|null;travellers:number|null;shortlist_agreed_by:string|null;shortlist_agreed_at:number|null;agreed_name:string|null}>();
 if(!bucket)throw notFound();
 const members=(await db.prepare('SELECT m.id,m.display_name,b.role,b.joined_at FROM bucket_members b JOIN members m ON m.id=b.member_id WHERE b.bucket_id=? ORDER BY b.joined_at').bind(id).all<{id:string;display_name:string;role:Role;joined_at:number}>()).results;
 const reelRows=(await db.prepare('SELECT r.id,r.source_key,r.source_url,r.added_by,r.added_at,r.status,r.analysis,m.display_name AS added_by_name FROM bucket_reels r LEFT JOIN members m ON m.id=r.added_by WHERE r.bucket_id=? ORDER BY r.added_at').bind(id).all<{id:string;source_key:string;source_url:string;added_by:string;added_at:number;status:ReelStatus;analysis:string|null;added_by_name:string|null}>()).results;
 const tallies=(await db.prepare('SELECT place_key,SUM(value=1) AS up,SUM(value=-1) AS down FROM place_votes WHERE bucket_id=? GROUP BY place_key').bind(id).all<{place_key:string;up:number;down:number}>()).results;
 const mine=(await db.prepare('SELECT place_key,value FROM place_votes WHERE bucket_id=? AND member_id=?').bind(id,member.id).all<{place_key:string;value:number}>()).results;
 const invites=(await db.prepare('SELECT id,created_by,expires_at FROM bucket_invites WHERE bucket_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC').bind(id,Date.now()).all<{id:string;created_by:string;expires_at:number}>()).results;
 const reels=reelRows.map(r=>{
  let parsed:Partial<ReelSnapshot>&{message?:string}={};try{parsed=r.analysis?JSON.parse(r.analysis):{};}catch{}
  const places=r.status!=='not_travel'&&Array.isArray(parsed.places)?parsed.places.map(p=>{const t=tallies.find(x=>x.place_key===p.id);return {...p,up:Number(t?.up||0),down:Number(t?.down||0),myVote:mine.find(x=>x.place_key===p.id)?.value||0};}):[];
  return {id:r.id,key:r.source_key,url:r.source_url,addedBy:{id:r.added_by,name:r.added_by_name||'A former member'},addedAt:r.added_at,status:r.status,
   title:parsed.source?.title||'',creator:parsed.source?.creator||'',platform:parsed.source?.platform||'',message:parsed.message||'',omittedDetails:typeof parsed.omittedDetails==='number'&&Number.isSafeInteger(parsed.omittedDetails)&&parsed.omittedDetails>0&&parsed.omittedDetails<=999?parsed.omittedDetails:0,places,
   canRemove:r.added_by===member.id||role==='owner'};
 });
 return {id:bucket.id,name:bucket.name,updatedAt:bucket.updated_at,me:{id:member.id,name:member.name,role},
  trip:{start:bucket.trip_start,end:bucket.trip_end,travellers:bucket.travellers??Math.min(Math.max(members.length,1),MAX_TRAVELLERS),travellersSet:bucket.travellers!==null},
  shortlist:bucket.shortlist_agreed_by?{by:{id:bucket.shortlist_agreed_by,name:bucket.agreed_name||'A former member'},at:bucket.shortlist_agreed_at}:null,
  members:members.map(m=>({id:m.id,name:m.display_name,role:m.role})),maxMembers:MAX_MEMBERS,reels,
  invites:invites.map(i=>({id:i.id,expiresAt:i.expires_at,canRevoke:role==='owner'||i.created_by===member.id}))};
}

export async function createInvite(db:Database,member:Member,bucketId:unknown){
 await roleIn(db,bucketId,member.id);
 const active=await db.prepare('SELECT count(*) AS n FROM bucket_invites WHERE bucket_id=? AND revoked_at IS NULL AND expires_at>?').bind(bucketId,Date.now()).first<{n:number}>();
 if((active?.n||0)>=MAX_ACTIVE_INVITES)throw new ServiceError('This bucket has 10 active invite links. Turn one off first.',409);
 const token=hex(crypto.getRandomValues(new Uint8Array(32))),id=crypto.randomUUID(),now=Date.now(),expiresAt=now+INVITE_DAYS*DAY;
 await db.prepare('INSERT INTO bucket_invites (id,token_hash,bucket_id,created_by,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,?,NULL)').bind(id,await hashToken(token),bucketId,member.id,now,expiresAt).run();
 // The raw token is returned once, to put in the link. Only its hash is kept.
 return {id,token,expiresAt};
}
export async function revokeInvite(db:Database,member:Member,bucketId:unknown,inviteId:unknown){
 const role=await roleIn(db,bucketId,member.id);
 const invite=uuid(inviteId)?await db.prepare('SELECT created_by FROM bucket_invites WHERE id=? AND bucket_id=?').bind(inviteId,bucketId).first<{created_by:string}>():null;
 if(!invite)throw new ServiceError('That invite link was not found.',404);
 if(role!=='owner'&&invite.created_by!==member.id)throw new ServiceError('Only the bucket owner or the person who made this link can turn it off.',403);
 await db.prepare('UPDATE bucket_invites SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),inviteId).run();
}

async function liveInvite(db:Database,token:unknown){
 if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))throw new ServiceError('This invite link is not valid. Ask for a new one.',404);
 const invite=await db.prepare('SELECT i.bucket_id,i.expires_at,i.revoked_at,b.name,m.display_name AS owner FROM bucket_invites i JOIN shared_buckets b ON b.id=i.bucket_id LEFT JOIN members m ON m.id=b.owner_member_id WHERE i.token_hash=?').bind(await hashToken(token)).first<{bucket_id:string;expires_at:number;revoked_at:number|null;name:string;owner:string|null}>();
 if(!invite)throw new ServiceError('This invite link is not valid. Ask for a new one.',404);
 if(invite.revoked_at!==null||invite.expires_at<=Date.now())throw new ServiceError('This invite link has expired or been turned off. Ask for a new one.',410);
 return invite;
}
const memberCount=async(db:Database,bucketId:string)=>Number((await db.prepare('SELECT count(*) AS n FROM bucket_members WHERE bucket_id=?').bind(bucketId).first<{n:number}>())?.n||0);

export async function previewInvite(db:Database,req:Request,token:unknown){
 const invite=await liveInvite(db,token),member=await currentMember(db,req);
 const already=member?!!(await db.prepare('SELECT 1 AS yes FROM bucket_members WHERE bucket_id=? AND member_id=?').bind(invite.bucket_id,member.id).first()):false;
 const members=await memberCount(db,invite.bucket_id);
 return {bucketName:invite.name,ownerName:invite.owner||'',members,maxMembers:MAX_MEMBERS,full:members>=MAX_MEMBERS,me:member?{name:member.name}:null,alreadyMember:already,...(already?{bucketId:invite.bucket_id}:{})};
}

// Join with an invite. A device without a member gives a name and becomes one.
export async function joinBucket(db:Database,req:Request,input:{token?:unknown;name?:unknown},beforeCreate:()=>Promise<void>=async()=>{}){
 const invite=await liveInvite(db,input.token);
 let member=await currentMember(db,req),cookie:string|undefined,joined=false;
 if(member&&await db.prepare('SELECT 1 AS yes FROM bucket_members WHERE bucket_id=? AND member_id=?').bind(invite.bucket_id,member.id).first())return {bucketId:invite.bucket_id,member,joined};
 if(await memberCount(db,invite.bucket_id)>=MAX_MEMBERS)throw new ServiceError('This bucket already has 6 members.',409);
 if(!member){const name=memberName(input.name);await beforeCreate();({member,cookie}=await createMember(db,name));}
 // One statement: the member count is checked and the row added together,
 // so two people joining at once cannot make a seventh member.
 const added=await db.prepare("INSERT INTO bucket_members (bucket_id,member_id,role,joined_at) SELECT ?,?,'editor',? WHERE (SELECT count(*) FROM bucket_members WHERE bucket_id=?)<? ON CONFLICT DO NOTHING RETURNING member_id").bind(invite.bucket_id,member.id,Date.now(),invite.bucket_id,MAX_MEMBERS).first();
 if(!added){
  const now=await db.prepare('SELECT 1 AS yes FROM bucket_members WHERE bucket_id=? AND member_id=?').bind(invite.bucket_id,member.id).first();
  if(!now)throw Object.assign(new ServiceError('This bucket already has 6 members.',409),{cookie});
 }else{joined=true;await touch(db,invite.bucket_id);}
 return {bucketId:invite.bucket_id,member,joined,cookie};
}

export async function addReel(db:Database,req:Request,member:Member,bucketId:unknown,rawUrl:unknown,refresh=false){
 await roleIn(db,bucketId,member.id);
 const url=typeof rawUrl==='string'&&rawUrl.length<=1000?normaliseLink(rawUrl):null;
 if(!url)throw new ServiceError('Paste one individual public Instagram or TikTok video link.',400);
 const key=reelID(url);
 const existing=await db.prepare('SELECT id,status,job_id,analysis,checked_at FROM bucket_reels WHERE bucket_id=? AND source_key=?').bind(bucketId,key).first<{id:string;status:ReelStatus;job_id:string|null;analysis:string|null;checked_at:number}>();
 // Refresh is explicit, still uses the normal cache/quota, and cannot duplicate a running job.
 if(existing&&existing.status!=='unavailable'&&!(refresh&&existing.status==='ready'))return {id:existing.id,added:false};
 if(!existing){
  const count=await db.prepare('SELECT count(*) AS n FROM bucket_reels WHERE bucket_id=?').bind(bucketId).first<{n:number}>();
  if((count?.n||0)>=MAX_REELS)throw new ServiceError('A shared bucket holds up to 50 reels.',409);
 }
 let result=await analyse(req,url);const now=Date.now();
 if(existing){
  result=retainPrevious(existing.analysis,result);
  const applied=await db.prepare('UPDATE bucket_reels SET status=?,job_id=?,analysis=?,checked_at=? WHERE id=? AND bucket_id=? AND status=? AND job_id IS ? AND checked_at=? AND analysis IS ? RETURNING id').bind(result.status,result.jobId,result.analysis,now,existing.id,bucketId,existing.status,existing.job_id,existing.checked_at,existing.analysis).first();
  if(applied){await clearRemovedPlaces(db,bucketId as string,existing.analysis,result.analysis);await touch(db,bucketId as string);}
  return {id:existing.id,added:false};
 }
 const id=crypto.randomUUID();
 const inserted=await db.prepare('INSERT INTO bucket_reels (id,bucket_id,source_key,source_url,added_by,added_at,status,job_id,analysis,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bucket_id,source_key) DO NOTHING RETURNING id').bind(id,bucketId,key,url,member.id,now,result.status,result.jobId,result.analysis,now).first<{id:string}>();
 if(!inserted){const row=await db.prepare('SELECT id FROM bucket_reels WHERE bucket_id=? AND source_key=?').bind(bucketId,key).first<{id:string}>();return {id:row?.id||id,added:false};}
 await touch(db,bucketId as string);
 return {id,added:true};
}

export async function removeReel(db:Database,member:Member,bucketId:unknown,reelId:unknown){
 const role=await roleIn(db,bucketId,member.id);
 const row=uuid(reelId)?await db.prepare('SELECT added_by,analysis,status FROM bucket_reels WHERE id=? AND bucket_id=?').bind(reelId,bucketId).first<{added_by:string;analysis:string|null;status:ReelStatus}>():null;
 if(!row)throw new ServiceError('That reel is not in this bucket.',404);
 if(row.added_by!==member.id&&role!=='owner')throw new ServiceError('Only the person who added this reel or the bucket owner can remove it.',403);
 await db.prepare('DELETE FROM bucket_reels WHERE id=?').bind(reelId).run();
 await clearRemovedPlaces(db,bucketId as string,row.analysis,null);
 await touch(db,bucketId as string);
}

export async function castVote(db:Database,member:Member,bucketId:unknown,placeKey:unknown,value:unknown){
 await roleIn(db,bucketId,member.id);
 if(value!==1&&value!==-1&&value!==0)throw new ServiceError('Vote up, down or clear your vote.',400);
 if(typeof placeKey!=='string'||!placeKey||placeKey.length>160)throw new ServiceError('Choose a place in this bucket.',400);
 // Votes attach only to places this bucket's reels actually contain.
 const {results}=await db.prepare("SELECT analysis FROM bucket_reels WHERE bucket_id=? AND status IN ('ready','analysing')").bind(bucketId).all<{analysis:string}>();
 const known=results.some(r=>{try{return (JSON.parse(r.analysis).places||[]).some((p:PlaceSnapshot)=>p.id===placeKey);}catch{return false;}});
 if(!known)throw new ServiceError('Choose a place in this bucket.',400);
 if(value===0)await db.prepare('DELETE FROM place_votes WHERE bucket_id=? AND place_key=? AND member_id=?').bind(bucketId,placeKey,member.id).run();
 else await db.prepare('INSERT INTO place_votes (bucket_id,place_key,member_id,value,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(bucket_id,place_key,member_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(bucketId,placeKey,member.id,value,Date.now()).run();
 await touch(db,bucketId as string);
}

// Trip details fill the booking links. Only the owner sets them; either both
// dates or neither, check-out after check-in, at most 60 nights, not in the past.
// Travellers 1–12; left unset it follows the member count.
export const MAX_TRAVELLERS=12,MAX_NIGHTS=60;
const isoDay=(value:unknown):string|null=>{
 if(value===''||value===null||value===undefined)return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new ServiceError('Choose real calendar dates.',400);
 return value;
};
export function tripDetails(input:{start?:unknown;end?:unknown;travellers?:unknown},today=new Date().toISOString().slice(0,10)){
 const start=isoDay(input.start),end=isoDay(input.end);
 if(!!start!==!!end)throw new ServiceError('Choose both a check-in and a check-out date, or neither.',400);
 if(start&&end){
  if(start<today)throw new ServiceError('Check-in can’t be in the past.',400);
  const nights=(Date.parse(end)-Date.parse(start))/86400000;
  if(nights<1)throw new ServiceError('Check-out must be after check-in.',400);
  if(nights>MAX_NIGHTS)throw new ServiceError('Choose a trip of 60 nights or fewer.',400);
 }
 const travellers=input.travellers===null||input.travellers===undefined||input.travellers===''?null:input.travellers;
 if(travellers!==null&&(!Number.isInteger(travellers)||(travellers as number)<1||(travellers as number)>MAX_TRAVELLERS))throw new ServiceError('Choose 1 to 12 travellers.',400);
 return {start,end,travellers:travellers as number|null};
}
export async function setTripDetails(db:Database,member:Member,bucketId:unknown,input:{start?:unknown;end?:unknown;travellers?:unknown}){
 const role=await roleIn(db,bucketId,member.id);
 if(role!=='owner')throw new ServiceError('Only the bucket owner can change the trip dates and travellers.',403);
 const trip=tripDetails(input);
 await db.prepare('UPDATE shared_buckets SET trip_start=?,trip_end=?,travellers=?,updated_at=? WHERE id=?').bind(trip.start,trip.end,trip.travellers,Date.now(),bucketId).run();
 return trip;
}
// "We've agreed our shortlist": any member can mark it, with who and when, or undo it.
export async function setShortlist(db:Database,member:Member,bucketId:unknown,agreed:unknown){
 await roleIn(db,bucketId,member.id);
 if(typeof agreed!=='boolean')throw new ServiceError('Choose agreed or not agreed.',400);
 await db.prepare('UPDATE shared_buckets SET shortlist_agreed_by=?,shortlist_agreed_at=?,updated_at=? WHERE id=?').bind(agreed?member.id:null,agreed?Date.now():null,Date.now(),bucketId).run();
 return {agreed};
}

// The owner deletes the bucket and everything linked to it: votes, reels and
// their place snapshots, bucket-scoped place fixes, invite tokens, memberships,
// the bucket's events, and the member records of anyone left in no other
// bucket (with their remaining events). The bucket row goes last, so a failure
// part-way leaves a bucket the owner can delete again rather than orphans.
export async function deleteSharedBucket(db:Database,member:Member,bucketId:unknown){
 const role=await roleIn(db,bucketId,member.id);
 if(role!=='owner')throw new ServiceError('Only the bucket owner can delete this bucket.',403);
 const id=bucketId as string;
 const people=(await db.prepare('SELECT member_id FROM bucket_members WHERE bucket_id=?').bind(id).all<{member_id:string}>()).results.map(r=>r.member_id);
 for(const query of ['DELETE FROM place_votes WHERE bucket_id=?','DELETE FROM bucket_reels WHERE bucket_id=?','DELETE FROM place_resolutions WHERE scope=?','DELETE FROM bucket_invites WHERE bucket_id=?','DELETE FROM events WHERE bucket_id=?','DELETE FROM bucket_members WHERE bucket_id=?'])
  await db.prepare(query).bind(id).run();
 let removedMembers=0;
 for(const person of people){
  const elsewhere=await db.prepare('SELECT 1 AS yes FROM bucket_members WHERE member_id=? LIMIT 1').bind(person).first();
  if(elsewhere)continue;
  await db.prepare('DELETE FROM events WHERE member_id=?').bind(person).run();
  await db.prepare('DELETE FROM members WHERE id=?').bind(person).run();
  removedMembers++;
 }
 await db.prepare('DELETE FROM shared_buckets WHERE id=?').bind(id).run();
 return {deleted:true,removedMembers};
}
