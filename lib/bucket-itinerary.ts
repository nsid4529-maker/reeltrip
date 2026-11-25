import {calendarDate} from './getyourguide.ts';

export type BucketChoicePlan={version:1;assignments:{interestId:string;date:string}[];notes:{date:string;text:string}[]};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const damaged='Your saved choice itinerary could not be read. Existing data has been kept unchanged.';
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
const date=(value:unknown):value is string=>typeof value==='string'&&calendarDate(value);

export function bucketItineraryKey(tripId:string):string{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tripId))throw new Error('Choose a valid bucket before saving an itinerary.');
 return 'reeltrip-bucket-choice-itinerary-v1:'+tripId.toLowerCase();
}
export function bucketItineraryDays({start,end}:{start:string;end:string}):string[]{
 if(!start&&!end)return [];
 if(!calendarDate(start)||(end&&!calendarDate(end)))throw new Error('Choose an arrival date to start assigning your choices.');
 const first=Date.parse(start),last=Date.parse(end||start),count=(last-first)/86400000+1;
 if(count<1||count>31)throw new Error('Choose a date range of up to 31 calendar days, with departure on or after arrival.');
 return Array.from({length:count},(_,index)=>new Date(first+index*86400000).toISOString().slice(0,10));
}
export function readBucketItinerary(raw:string|null):BucketChoicePlan{
 if(raw===null)return {version:1,assignments:[],notes:[]};
 try{
  if(raw.length>1_000_000)throw new Error(damaged);
  const value=JSON.parse(raw);
  if(!value||value.version!==1||!Array.isArray(value.assignments)||value.assignments.length>200||!Array.isArray(value.notes)||value.notes.length>200)throw new Error(damaged);
  if(value.assignments.some((row:BucketChoicePlan['assignments'][number])=>!row||!text(row.interestId,1024)||!row.interestId.trim()||!date(row.date))||new Set(value.assignments.map((row:BucketChoicePlan['assignments'][number])=>row.interestId)).size!==value.assignments.length)throw new Error(damaged);
  if(value.notes.some((row:BucketChoicePlan['notes'][number])=>!row||!date(row.date)||!text(row.text,3000))||new Set(value.notes.map((row:BucketChoicePlan['notes'][number])=>row.date)).size!==value.notes.length)throw new Error(damaged);
  return {version:1,assignments:value.assignments.map((row:BucketChoicePlan['assignments'][number])=>({interestId:row.interestId,date:row.date})),notes:value.notes.map((row:BucketChoicePlan['notes'][number])=>({date:row.date,text:row.text}))};
 }catch{throw new Error(damaged);}
}
function write(storage:StorageLike,key:string,plan:BucketChoicePlan):BucketChoicePlan{
 const raw=JSON.stringify(plan),checked=readBucketItinerary(raw);storage.setItem(key,raw);return checked;
}
export function assignBucketChoice(storage:StorageLike,tripId:string,interestId:string,day:string):BucketChoicePlan{
 const key=bucketItineraryKey(tripId),plan=readBucketItinerary(storage.getItem(key));
 if(!text(interestId,1024)||!interestId.trim()||(day!==''&&!date(day)))throw new Error('Choose a saved item and valid itinerary day.');
 const assignments=plan.assignments.filter(row=>row.interestId!==interestId);
 if(day)assignments.push({interestId,date:day});
 if(assignments.length>200)throw new Error('This itinerary holds up to 200 choice assignments. Clear an old assignment first.');
 return write(storage,key,{...plan,assignments});
}
export function saveBucketDayNote(storage:StorageLike,tripId:string,day:string,note:string):BucketChoicePlan{
 const key=bucketItineraryKey(tripId),plan=readBucketItinerary(storage.getItem(key));
 if(!date(day)||!text(note,3000))throw new Error('Choose a valid day and keep its note within 3,000 characters.');
 const notes=plan.notes.filter(row=>row.date!==day);
 if(note)notes.push({date:day,text:note});
 if(notes.length>200)throw new Error('This itinerary holds notes for up to 200 dates. Clear an old note first.');
 return write(storage,key,{...plan,notes});
}
