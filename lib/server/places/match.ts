import {normalise} from './fixture.ts';
import type {Candidate} from './provider.ts';

// Turning a place from a reel into a real venue. Confidence comes from how
// closely the candidate's name matches, whether its address agrees with the
// reel's area, and how many candidates compete. Low confidence is only ever a
// "possible match" for a person to confirm; it is never shown as the venue.
export type Confidence='high'|'medium'|'low'|'none';
export type Resolution={status:'matched'|'possible'|'unmatched'|'not_a_venue';confidence:Confidence;candidate:Candidate|null};
export type PlaceInput={key:string;title:string;place:string;query?:string;kind?:string;category?:string};

const STOP=new Set(['the','a','an','at','and','of','by','in','on','to']);
// Area words that say nothing about where a venue is.
const VAGUE=new Set(['area','exact','location','confirm','arrival','stop','across','country','hill','coast','south','north','east','west','central','town','sri','lanka','province','district']);
const tokens=(value:string)=>normalise(value).split(' ').filter(t=>t&&!STOP.has(t));

// Unknown stays unknown: suggestions, area searches, routes and booking
// platforms are not venues named in the reel, so they are never looked up.
export function isNamedVenue(input:PlaceInput){
 if(input.category==='Transport')return false;
 return !/unnamed|suggested|comparable|booking platform|route|area search/i.test(input.kind||'');
}
// "Sunset drinks at Café Soul" names Café Soul; "Pidurangala at sunrise" does not
// name "sunrise", so only a capitalised name after "at" counts.
export function venueName(title:string){const at=title.match(/^.+?\s+at\s+(\p{Lu}.+)$/u);return (at?at[1]:title).trim();}

export function similarity(a:string,b:string){
 const x=normalise(a),y=normalise(b);if(!x||!y)return 0;if(x===y)return 1;
 const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;
 const shared=[...A].filter(t=>B.has(t)).length,dice=2*shared/(A.size+B.size);
 // One name wholly inside the other ("Kai Ahangama" in "Kai Ahangama Rooftop Cafe").
 const within=[...A].every(t=>B.has(t))||[...B].every(t=>A.has(t));
 return within?Math.max(dice,0.85):dice;
}
export function areaAgrees(area:string,address:string):boolean|null{
 const wanted=tokens(area).filter(t=>!VAGUE.has(t)&&t.length>2);if(!wanted.length)return null;
 const have=new Set(tokens(address));return wanted.some(t=>have.has(t));
}

export function resolve(input:PlaceInput,candidates:Candidate[]):Resolution{
 if(!isNamedVenue(input))return {status:'not_a_venue',confidence:'none',candidate:null};
 if(!candidates.length)return {status:'unmatched',confidence:'none',candidate:null};
 const name=venueName(input.title);
 const scored=candidates.map((c,index)=>({c,index,sim:similarity(name,c.name),area:areaAgrees(input.place,c.address)}))
  .sort((a,b)=>b.sim-a.sim||Number(b.area===true)-Number(a.area===true)||a.index-b.index);
 const best=scored[0],second=scored[1]?.sim??0,clear=scored.length===1||best.sim-second>=0.15;
 // A same-name rival elsewhere is fine if this one is in the reel's area and the rival is not.
 const rivalsOutside=scored.slice(1).every(s=>s.sim<best.sim-0.15||s.area===false);
 if(best.sim>=0.85&&best.area===true&&(clear||rivalsOutside))return {status:'matched',confidence:'high',candidate:best.c};
 if(best.sim>=0.7&&best.area!==false&&(clear||rivalsOutside))return {status:'matched',confidence:'medium',candidate:best.c};
 if(best.sim>=0.45)return {status:'possible',confidence:'low',candidate:best.c};
 return {status:'unmatched',confidence:'none',candidate:null};
}
