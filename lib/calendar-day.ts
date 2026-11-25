// Travel dates are calendar days in the visitor's timezone. Requests carry only
// the zone: the server derives today from its own clock, never a client date.
export function calendarTimeZone(value:unknown='UTC'):string{
 if(typeof value!=='string'||value.length>100||!/^\w[\w+-]*(?:\/[\w+-]+){0,2}$/.test(value))throw new Error('Choose a valid time zone.');
 try{return new Intl.DateTimeFormat('en-GB',{timeZone:value}).resolvedOptions().timeZone;}catch{throw new Error('Choose a valid time zone.');}
}
export function localTimeZone():string{
 return calendarTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');
}
export function calendarDay(timeZone=localTimeZone(),now=new Date()):string{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:calendarTimeZone(timeZone),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(value=>value.type===type)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function calendarDayIn(days:number,timeZone=localTimeZone(),now=new Date()):string{
 const today=calendarDay(timeZone,now);
 return new Date(Date.parse(today)+days*86400000).toISOString().slice(0,10);
}
