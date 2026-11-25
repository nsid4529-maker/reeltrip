import {isEventName,validEventProps,type EventName,type EventProps} from './events.ts';

// Fire-and-forget product event. Never throws, never blocks the UI, and drops
// anything the allow-list would reject before it leaves the device.
export function track(name:EventName,props:EventProps={},bucketId?:string,send:typeof fetch|undefined=globalThis.fetch):void{
 try{
  if(!isEventName(name)||typeof send!=='function')return;
  const body=JSON.stringify({name,props:validEventProps(name,props),...(bucketId?{bucketId}:{})});
  void send('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true,credentials:'same-origin'}).catch(()=>{});
 }catch{/* Measurement must never affect the product. */}
}
