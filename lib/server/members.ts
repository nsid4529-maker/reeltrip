import {ServiceError} from './http-safety.ts';

// Invite-link identity. A member is a display name plus a random device token
// kept in an httpOnly cookie. Only the token's SHA-256 hash is stored, so the
// database alone can never be used to act as a member. Guests need none of this.
export const MEMBER_COOKIE='__Host-reeltrip_member';
const MAX_AGE=60*60*24*365;
export type Member={id:string;name:string};
type Database={prepare(query:string):{bind(...values:unknown[]):{first<T>():Promise<T|null>;run():Promise<unknown>}}};

const hex=(bytes:ArrayBuffer|Uint8Array)=>Array.from(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function hashToken(token:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));}

export function memberName(value:unknown):string{
 if(typeof value!=='string')throw new ServiceError('Enter your name in 1–40 characters.',400);
 const name=value.trim().normalize('NFC');
 if(!name||[...name].length>40||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))throw new ServiceError('Enter your name in 1–40 characters.',400);
 return name;
}

export function memberToken(request:Request):string|null{
 const values=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(MEMBER_COOKIE+'='));
 const token=values.length===1?values[0].slice(MEMBER_COOKIE.length+1):'';
 return /^[0-9a-f]{64}$/.test(token)?token:null;
}

export async function currentMember(db:Database,request:Request):Promise<Member|null>{
 const token=memberToken(request);if(!token)return null;
 const row=await db.prepare('SELECT id,display_name FROM members WHERE token_hash=?').bind(await hashToken(token)).first<{id:string;display_name:string}>();
 return row?{id:row.id,name:row.display_name}:null;
}

export async function createMember(db:Database,name:string):Promise<{member:Member;cookie:string}>{
 const token=hex(crypto.getRandomValues(new Uint8Array(32))),member={id:crypto.randomUUID(),name};
 await db.prepare('INSERT INTO members (id,display_name,token_hash,created_at) VALUES (?,?,?,?)').bind(member.id,name,await hashToken(token),Date.now()).run();
 // __Host- requires Secure and Path=/ with no Domain, which pins it to this exact host.
 return {member,cookie:`${MEMBER_COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`};
}

export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)throw new ServiceError('Invalid request origin.',403);
}
