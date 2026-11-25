import {readRequestBody} from '@/lib/server/request-body';
import {pollAnalysis,ServiceError} from '@/lib/server/processing';
import {analyseLink,normaliseLink} from '@/lib/server/analyse-link';
import {extractEach} from '@/lib/server/extract-links';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function error(e:unknown){return Response.json({error:e instanceof ServiceError?e.message:'Video analysis could not be started. Please try again.'},{status:e instanceof ServiceError?e.status:503,headers});}
export async function POST(req:Request){
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)throw new ServiceError('Invalid request origin.',403);
  const raw=await readRequestBody(req,4096);
  let urls:unknown;try{urls=JSON.parse(raw).urls;}catch{throw new ServiceError('Invalid request.',400);}
  if(!Array.isArray(urls)||!urls.length||urls.length>4||urls.some(u=>typeof u!=='string'||u.length>1000))throw new ServiceError('Add one to four video URLs.',400);
  const {clips,failure}=await extractEach(urls as string[],normaliseLink,url=>analyseLink(req,url));
  if(failure)throw failure;
  return Response.json({clips},{headers});
 }catch(e){return error(e);}
}
export async function GET(req:Request){try{return Response.json({clips:[await pollAnalysis(req,new URL(req.url).searchParams.get('job')||'')]},{headers});}catch(e){return error(e);}}
