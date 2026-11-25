export class ServiceError extends Error {
 status:number;
 constructor(message:string,status=503){super(message);this.status=status;}
}

// Enforce byte and wall-clock limits while reading, including chunked bodies.
export async function boundedText(message:Request|Response,limit:number,timeoutMs=15000):Promise<string>{
 const length=message.headers.get('content-length');
 if(length!==null&&(!/^\d{1,12}$/.test(length)||Number(length)>limit))throw new ServiceError('Message too large.',413);
 if(!message.body)return '';
 const reader=message.body.getReader(),parts:Uint8Array[]=[];let total=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ServiceError('Message timed out.',408)),timeoutMs);});
 try{
  for(;;){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;
   total+=value.byteLength;if(total>limit)throw new ServiceError('Message too large.',413);parts.push(value);
  }
 }catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{clearTimeout(timer);reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ServiceError('Invalid message encoding.',400);}
}

export async function boundedJSON<T=unknown>(response:Response,limit=1000000):Promise<T>{
 try{return JSON.parse(await boundedText(response,limit)) as T;}
 catch{throw new ServiceError('The connected service returned an invalid response. Please try again later.');}
}

// This app runs only behind Cloudflare's edge. Never use client-supplied forwarding
// headers as fallback identities. Missing edge identity shares one conservative cap.
export function quotaVisitor(headers:Headers):string{return headers.get('cf-connecting-ip')?.slice(0,64)||'unknown';}

export function secureResponse(response:Response,api=false):Response{
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 // SSR needs inline hydration scripts; avoid pretending an unsafe-inline policy
 // prevents script injection. React escapes source text; never render reel HTML.
 headers.set('Content-Security-Policy',"object-src 'none'; base-uri 'self'; frame-src 'self' https://www.instagram.com https://www.tiktok.com https://widget.getyourguide.com https://widgets.skyscanner.net https://www.skyscanner.net; form-action 'self'");
 if(api)headers.set('Cache-Control','no-store');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
