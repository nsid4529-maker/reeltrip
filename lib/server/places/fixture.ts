import type {Candidate,PlaceDetails,PlacesProvider} from './provider.ts';

// Deterministic SAMPLE venues for tests and local checks (PLACES_PROVIDER=fixture).
// They are not real listings: addresses are marked as sample data and the UI
// labels this provider "Sample data". A few entries are deliberately ambiguous
// or misleading so confidence rules and "Fix it" can be exercised.
type Venue=Candidate&{tokens:string[]};
const venue=(id:string,name:string,address:string,lat:number,lng:number):Venue=>({id:'fixture_'+id,name,address:address+' (sample data)',lat,lng,tokens:normalise(name+' '+address).split(' ')});
export function normalise(value:string){return value.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();}
const VENUES:Venue[]=[
 venue('cafe_soul','Café Soul','Passara Road, Ella, Sri Lanka',6.8667,81.0466),
 venue('soul_food','Soul Food Kitchen','Galle Road, Colombo, Sri Lanka',6.9,79.85),
 venue('nine_arch','Nine Arch Bridge','Demodara, Ella, Sri Lanka',6.8768,81.0608),
 venue('ravana_pool','Ravana Pool Club','Ella Town, Ella, Sri Lanka',6.8723,81.0463),
 venue('roys_villa','Roy’s Villa','Sigiriya, Sri Lanka',7.9533,80.7553),
 venue('pidurangala','Pidurangala Rock','Pidurangala, Sigiriya, Sri Lanka',7.9658,80.7612),
 // A plausible but wrong first result: same name, different town.
 venue('paradise_cove_unawatuna','Paradise Cove Resort','Unawatuna, Sri Lanka',6.0106,80.2489),
 venue('paradise_cove','Paradise Cove','Midigama, Sri Lanka',5.9636,80.3878),
 venue('kai','Kai Ahangama Rooftop Cafe and Bar','Ahangama, Sri Lanka',5.9721,80.3686),
 venue('cactus_ahangama','Cactus','Ahangama, Sri Lanka',5.9735,80.3652),
 venue('cactus_colombo','Cactus Bar','Colombo, Sri Lanka',6.91,79.86),
 venue('raas','Raa’s','Hiriketiya, Dickwella, Sri Lanka',5.963,80.704),
 venue('smoke_bitters','Smoke and Bitters','Hiriketiya, Dickwella, Sri Lanka',5.9632,80.7051),
 venue('malkoha','Malkoha Hiriketiya','Hiriketiya, Dickwella, Sri Lanka',5.9641,80.7066),
 venue('yala','Yala National Park','Southern Province, Sri Lanka',6.3728,81.5016),
 venue('wilpattu','Wilpattu National Park','North Western Province, Sri Lanka',8.4559,80.0154),
 venue('villa_ceylon','The Villa Bentota','Bentota, Sri Lanka',6.4189,79.9961),
];
const STOP=new Set(['the','a','an','at','and','of','by','in','on','to','sri','lanka']);
export function fixtureProvider():PlacesProvider{
 return {
  name:'fixture',
  async search(textQuery){
   const wanted=normalise(textQuery).split(' ').filter(t=>t&&!STOP.has(t));
   const scored=VENUES.map((v,index)=>({v,index,hits:wanted.filter(t=>v.tokens.includes(t)).length})).filter(x=>x.hits>0);
   // Stable order: most shared words first, then list order (so the wrong Paradise Cove can come first).
   scored.sort((a,b)=>b.hits-a.hits||a.index-b.index);
   return scored.slice(0,5).map(({v:{tokens,...c}})=>c);
  },
  async details(id){const found=VENUES.find(v=>v.id===id);if(!found)return null;const {tokens,...c}=found;return {...c,mapsUri:''} as PlaceDetails;},
 };
}
