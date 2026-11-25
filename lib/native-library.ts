import type {Reel} from './reel-library';
export type NativeBundle={id:string;name:string;urls:string[];createdAt:string;updatedAt?:string};
export type NativeShare={id:string;urls:string[];bundleId?:string|null;jobs?:Record<string,string>;openAnalysis?:boolean;sharedBucketId?:string|null};
export type NativeSharedBucket={id:string;name:string};
export type NativeInterest={id:string;url:string;title:string;kind:'activity'|'hotel'|'restaurant';provider:string;addedAt:string};
type NativeMessage={action:'library'}|{action:'save';urls:string[]}|{action:'remove';url:string}|{action:'bundles';bundles:NativeBundle[]}|{action:'acknowledge';ids:string[]}|{action:'acknowledgeInterests';ids:string[]}|{action:'sharedBuckets';buckets:NativeSharedBucket[]};
type BridgeWindow=Window&{webkit?:{messageHandlers?:{reeltripLibrary?:{postMessage:(value:NativeMessage)=>void}}}};
export const hasNativeBridge=()=>typeof window!=='undefined'&&!!(window as BridgeWindow).webkit?.messageHandlers?.reeltripLibrary;
export function nativeLibrary(message:NativeMessage):boolean{
 if(typeof window==='undefined')return false;
 const bridge=(window as BridgeWindow).webkit?.messageHandlers?.reeltripLibrary;
 if(!bridge)return false;
 bridge.postMessage(message);return true;
}
export function nativeLibraryError(detail:unknown):string|null{
 if(!detail||typeof detail!=='object'||Array.isArray(detail))return null;
 const error=(detail as Record<string,unknown>).error;
 return typeof error==='string'?error.slice(0,240).replace(/[\u0000-\u001f\u007f]/g,' ').trim()||null:null;
}
export type NativeLibraryEvent=CustomEvent<{videos?:Pick<Reel,'url'|'addedAt'>[];bundles?:NativeBundle[];pendingShares?:NativeShare[];pendingInterests?:NativeInterest[];error?:string}>;
