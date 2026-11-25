import {sharedRoute,ok} from '@/lib/server/shared-route';
import {createInvite,revokeInvite} from '@/lib/server/shared-buckets';
export const dynamic='force-dynamic';
// Make an invite link (the token is returned once) or turn one off.
export async function POST(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>ok(await createInvite(db,member,body.bucketId),201));}
export async function DELETE(req:Request){return sharedRoute(req,{kind:'shared',body:1024},async({db,member,body})=>{await revokeInvite(db,member,body.bucketId,body.inviteId);return ok({revoked:true});});}
