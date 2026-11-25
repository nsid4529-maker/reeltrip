import catalog from '../catalog.json';
import designReference from '../design-reference.json';
import {canonicalKey,matches} from '../travel.ts';
import {sharedLinks} from '../shared-links.ts';
import {startAnalysis} from './processing.ts';
import type {LinkClip} from './extract-links.ts';

// One public Instagram/TikTok link, or null. The same rule /api/extract uses.
export function normaliseLink(raw:string):string|null{const link=sharedLinks(new URLSearchParams({url:raw})).links;return link.length===1?link[0]:null;}

// Reviewed catalogue and reference reels never reach the processor; everything
// else goes through startAnalysis, with its cache, job reuse and quota rules.
export async function analyseLink(req:Request,url:string):Promise<LinkClip>{
 let key='';try{key=canonicalKey(url);}catch{}
 const found=catalog.find(c=>canonicalKey(c.source_url)===key);
 if(key===canonicalKey(designReference.source_url))return {status:'reference_reviewed',reference:designReference,message:'This is a UI design reference, not a holiday itinerary.'};
 if(found)return {status:'analysis_cached',source:found,matches:matches.filter(m=>m.source===found.id)};
 return await startAnalysis(req,url) as LinkClip;
}
