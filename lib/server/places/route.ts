import {ServiceError} from '../http-safety.ts';
import {readRequestBody} from '../request-body.ts';
import {database,quota} from '../processing.ts';
import {currentMember,sameOrigin,type Member} from '../members.ts';
import {placesProvider,type PlacesProvider} from './provider.ts';
import type {Database} from '../shared-buckets.ts';
import type {Charge} from './service.ts';

const headers={'Cache-Control':'no-store','Vary':'Cookie'};
type Context={db:Database;member:Member|null;provider:PlacesProvider|null;charge:Charge;body:Record<string,unknown>};
// Origin check, request rate limit, then the body. Each provider call is charged
// separately against a daily cap per member (or per visitor for guests).
export async function placesRoute(req:Request,options:{body?:number},run:(context:Context)=>Promise<unknown>):Promise<Response>{
 try{
  sameOrigin(req);
  const db=database() as unknown as Database,member=await currentMember(db,req);
  await quota(req,'poll');
  let body:Record<string,unknown>={};
  if(options.body){try{const value=JSON.parse(await readRequestBody(req,options.body));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();body=value;}catch(e){throw e instanceof ServiceError?e:new ServiceError('Invalid request.',400);}}
  const charge:Charge=()=>quota(req,'places',member?.id).then(()=>{});
  return Response.json(await run({db,member,provider:placesProvider(process.env),charge,body}),{headers});
 }catch(e){return Response.json({error:e instanceof ServiceError?e.message:'Places could not be checked right now.'},{status:e instanceof ServiceError?e.status:503,headers});}
}
