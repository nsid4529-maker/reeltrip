// The map uses a SECOND Google key that is public by design: it sits in the
// browser and is restricted to ReelTrip's websites and the Maps JavaScript API.
// It is served at runtime from GOOGLE_MAPS_BROWSER_KEY and never built into the
// bundle. The Places key (GOOGLE_PLACES_API_KEY) is server-only and is never
// returned here, even if someone puts the same value in both variables.
export type MapConfig={browserKey:string|null;mapId:string;reason?:'not_configured'|'key_reused'|'invalid_key'};
export function mapConfig(env:Record<string,string|undefined>):MapConfig{
 const key=env.GOOGLE_MAPS_BROWSER_KEY?.trim()||'',places=env.GOOGLE_PLACES_API_KEY?.trim()||'';
 // Advanced Markers need a Map ID; Google's DEMO_MAP_ID works for testing.
 const mapId=/^[A-Za-z0-9_-]{1,64}$/.test(env.GOOGLE_MAPS_MAP_ID?.trim()||'')?env.GOOGLE_MAPS_MAP_ID!.trim():'DEMO_MAP_ID';
 if(!key)return {browserKey:null,mapId,reason:'not_configured'};
 if(places&&key===places)return {browserKey:null,mapId,reason:'key_reused'};
 if(!/^[A-Za-z0-9_-]{20,100}$/.test(key))return {browserKey:null,mapId,reason:'invalid_key'};
 return {browserKey:key,mapId};
}
