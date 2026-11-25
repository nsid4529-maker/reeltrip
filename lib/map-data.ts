import type {PlaceView} from './places-client.ts';

// Only matched venues with live coordinates become pins. Missing or failed
// locations stay unplotted; they are never inferred from a reel's area name.
export type MapGroup={id:string;name:string;colour:string};
export type MapPlaceInput={key:string;title:string;place:string;group:{id:string;name:string};view:PlaceView|null;up?:number;down?:number;source?:{url:string;creator?:string;second?:number}};
export type Pin={key:string;title:string;lat:number;lng:number;groupId:string;colour:string;placeId:string|null;up?:number;down?:number;source?:MapPlaceInput['source']};
// Distinct, colour-blind-friendlier hues that stay readable on the map.
export const PIN_COLOURS=['#2f7258','#b5532a','#3e5fa8','#8a4f9e','#a07b12','#1f7a8c','#b03a5b','#5b6b2f'];
const valid=(lat:unknown,lng:unknown)=>typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
export function mapData(places:MapPlaceInput[]){
 const groups:MapGroup[]=[],pins:Pin[]=[];let notOnMap=0;
 const colourOf=(group:{id:string;name:string})=>{let g=groups.find(x=>x.id===group.id);if(!g){g={...group,colour:PIN_COLOURS[groups.length%PIN_COLOURS.length]};groups.push(g);}return g.colour;};
 for(const p of places){
  const v=p.view;
  // Unnamed venues and places marked not real are never "missing" from the map.
  if(!v||v.status==='not_a_venue'||v.status==='not_a_place')continue;
  if(v.status!=='matched'||!valid(v.lat,v.lng)){notOnMap++;continue;}
  pins.push({key:p.key,title:p.title,lat:v.lat!,lng:v.lng!,groupId:p.group.id,colour:colourOf(p.group),placeId:v.placeId,up:p.up,down:p.down,source:p.source});
 }
 const centre=pins.length?{lat:pins.reduce((s,p)=>s+p.lat,0)/pins.length,lng:pins.reduce((s,p)=>s+p.lng,0)/pins.length}:null;
 return {pins,groups:groups.filter(g=>pins.some(p=>p.groupId===g.id)),notOnMap,centre};
}
