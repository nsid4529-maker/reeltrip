// The only product events ReelTrip records, and the only properties each may
// carry. Values are short codes, numbers or true/false: free text, URLs, reel
// captions, names and email addresses cannot pass. Shared by client and server.
export const EVENT_PROPS={
 reel_added:{source:['link','upload','share'],platform:['Instagram','TikTok','Uploaded video'],destination:['individual','bundle','trip'],analyse:'boolean'},
 place_viewed:{placeId:'id'},
 vote_cast:{placeId:'id',vote:['up','down']},
 member_joined:{},
 plan_finished:{placeCount:'count'},
 // Partner and link type only: never the URL, the venue or the place.
 outbound_click:{provider:['booking','expedia','viator','getyourguide','opentable','sevenrooms','skyscanner','other'],linkType:['stay_search','stay_property','place_reserve','activity_search']},
} as const;
export type EventName=keyof typeof EVENT_PROPS;
export type EventProps=Record<string,string|number|boolean>;
export const EVENT_PROPS_MAX_BYTES=1024;

const ID=/^[A-Za-z0-9_.:-]{1,100}$/;
export function isEventName(value:unknown):value is EventName{return typeof value==='string'&&Object.hasOwn(EVENT_PROPS,value);}

// Returns the cleaned props or throws with a short reason.
export function validEventProps(name:EventName,value:unknown):EventProps{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Event properties must be an object.');
 const allowed=EVENT_PROPS[name] as Record<string,readonly string[]|'boolean'|'id'|'count'>,clean:EventProps={};
 for(const [key,item] of Object.entries(value)){
  const rule=allowed[key];
  if(!rule)throw new Error('Unknown event property: '+key.slice(0,40));
  const ok=rule==='boolean'?typeof item==='boolean':rule==='count'?Number.isInteger(item)&&(item as number)>=0&&(item as number)<=10000:rule==='id'?typeof item==='string'&&ID.test(item):typeof item==='string'&&rule.includes(item);
  if(!ok)throw new Error('Invalid value for event property: '+key);
  clean[key]=item as string|number|boolean;
 }
 if(new TextEncoder().encode(JSON.stringify(clean)).length>EVENT_PROPS_MAX_BYTES)throw new Error('Event properties are too large.');
 return clean;
}
export function validBucketId(value:unknown):string|null{
 if(value===undefined||value===null)return null;
 if(typeof value!=='string'||!ID.test(value))throw new Error('Invalid bucket.');
 return value;
}
