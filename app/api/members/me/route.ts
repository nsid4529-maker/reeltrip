import {ServiceError} from '@/lib/server/http-safety';
import {database,quota} from '@/lib/server/processing';
import {currentMember,memberToken} from '@/lib/server/members';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','Vary':'Cookie'};

// Who is this device? {id,name} for a member, 401 for a guest.
export async function GET(req:Request){
 try{
  if(!memberToken(req))return Response.json({error:'Not signed in as a member.'},{status:401,headers});
  await quota(req,'poll');
  const member=await currentMember(database(),req);
  if(!member)return Response.json({error:'Not signed in as a member.'},{status:401,headers});
  return Response.json(member,{headers});
 }catch(e){return Response.json({error:e instanceof ServiceError?e.message:'Membership could not be checked. Please try again.'},{status:e instanceof ServiceError?e.status:503,headers});}
}
