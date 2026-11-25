// updatedAt is the last edit to the bundle; older saved bundles may not have one.
export type ReelBucket={id:string;name:string;reelIds:string[];createdAt:string;updatedAt?:string};
const validStamp=(value:unknown):value is string=>typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value));
export const BUCKETS_KEY='reeltrip-buckets-v1';
export function readBuckets(raw:string|null,validReelIds?:string[]):ReelBucket[]{
 try{const value=JSON.parse(raw||'[]');if(!Array.isArray(value))return [];
 const seen=new Set<string>();return value.filter((b:ReelBucket)=>{if(!b||typeof b.id!=='string'||!b.id||seen.has(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||!Array.isArray(b.reelIds)||typeof b.createdAt!=='string'||Number.isNaN(Date.parse(b.createdAt)))return false;seen.add(b.id);return true;}).slice(0,20).map(({updatedAt,...b}:ReelBucket)=>({...b,...(validStamp(updatedAt)?{updatedAt}:{}),reelIds:[...new Set(b.reelIds.filter(id=>typeof id==='string'&&(!validReelIds||validReelIds.includes(id))))].slice(0,12)}));
 }catch{return [];}
}
export function createBucket(list:ReelBucket[],name:string):ReelBucket[]{
 const clean=name.trim();if(!clean||clean.length>80)throw new Error('Name this bundle in 1–80 characters.');
 if(list.length>=20)throw new Error('You can save up to 20 bundles.');
 if(list.some(b=>b.name.toLowerCase()===clean.toLowerCase()))throw new Error('A bundle with that name already exists.');
 const now=new Date().toISOString();
 return [...list,{id:crypto.randomUUID(),name:clean,reelIds:[],createdAt:now,updatedAt:now}];
}
export function assignReel(list:ReelBucket[],bucketId:string,reelId:string,include=true):ReelBucket[]{
 if(!list.some(b=>b.id===bucketId))throw new Error('Choose an existing bundle.');
 if(!reelId)throw new Error('Choose a reel from your library.');
 // No change in membership means no new edit time, so replayed shares stay idempotent.
 return list.map(b=>{if(b.id!==bucketId||b.reelIds.includes(reelId)===include)return b;const ids=b.reelIds.filter(id=>id!==reelId);if(include)ids.push(reelId);if(ids.length>12)throw new Error('A bundle can contain up to 12 reels.');return {...b,reelIds:ids,updatedAt:new Date().toISOString()};});
}
export function removeBucket(list:ReelBucket[],bucketId:string):ReelBucket[]{return list.filter(b=>b.id!==bucketId);}

// A new bundle is a snapshot. Originals keep their names and membership.
export function combineBuckets(list:ReelBucket[],ids:string[],name:string):ReelBucket[]{
 const unique=[...new Set(ids)];if(unique.length<2)throw new Error('Choose at least two bundles to combine.');
 const chosen=unique.map(id=>list.find(b=>b.id===id));if(chosen.some(b=>!b))throw new Error('A selected bundle no longer exists.');
 const reelIds=[...new Set(chosen.flatMap(b=>b!.reelIds))];
 if(reelIds.length>12)throw new Error('The combined bundle would exceed 12 unique reels. Choose smaller bundles.');
 const next=createBucket(list,name);next[next.length-1].reelIds=reelIds;return next;
}
