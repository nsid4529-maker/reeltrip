import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness} from './helpers/component-harness.mjs';

// The shortlist and trip-details panels of a shared bucket.
const bucket=(extra={})=>({id:'00000000-0000-4000-8000-0000000000a9',name:'Lisbon',updatedAt:1,me:{id:'m2',name:'Ana',role:'editor'},members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}],maxMembers:6,
 reels:[{id:'r',places:[{id:'a',up:2,down:0},{id:'b',up:0,down:1},{id:'c',up:1,down:1}]}],invites:[],trip:{start:null,end:null,travellers:2,travellersSet:false},shortlist:null,...extra});
async function panel(name,props,client={}){
 const tracked=[],calls=[],real=await import('../lib/shared-client.ts');
 const h=await componentHarness('components/shared-bucket.tsx',{expose:[name],exportName:name,props:{onChanged(){},onSaved(){},...props},modules:{'@/lib/track':{track:(...a)=>tracked.push(a)},
  '@/lib/shared-client':{...real,setShortlistAgreed:async(...a)=>{calls.push(['shortlist',...a]);return {};},setSharedTrip:async(...a)=>{calls.push(['trip',...a]);return {};},...client}}});
 await h.flush();return {h,tracked,calls};
}
const button=(h,text)=>h.elements(n=>n.type==='button'&&h.text(n).includes(text))[0];

test('agreeing the shortlist records it and fires plan_finished with a count only',async()=>{
 const {h,tracked,calls}=await panel('Shortlist',{bucket:bucket()});
 await button(h,'We’ve agreed our shortlist').props.onClick();await h.flush();
 assert.deepEqual(calls[0].slice(1),['00000000-0000-4000-8000-0000000000a9',true]);
 assert.equal(JSON.stringify(tracked),JSON.stringify([['plan_finished',{placeCount:2},'00000000-0000-4000-8000-0000000000a9']]),'places with at least one keep vote');
});
test('an agreed shortlist shows who and when, and any member can undo it without an event',async()=>{
 const at=Date.UTC(2026,11,3,12);
 const {h,tracked,calls}=await panel('Shortlist',{bucket:bucket({shortlist:{by:{id:'m1',name:'Mei'},at}})});
 assert.match(h.text(),/Shortlist agreed by Mei, 3 Dec/);
 await button(h,'Undo').props.onClick();await h.flush();
 assert.deepEqual(calls[0].slice(2),[false]);assert.deepEqual(tracked,[]);
});
test('only the owner gets the trip details form; members see a summary',async()=>{
 const member=await panel('TripDetails',{bucket:bucket()});
 assert.equal(member.h.elements(n=>n.type==='form').length,0);
 assert.match(member.h.text(),/Dates not set yet · 2 travellers \(one per member until the owner sets it\)/);
 const owner=await panel('TripDetails',{bucket:bucket({me:{id:'m1',name:'Mei',role:'owner'},trip:{start:'2027-01-15',end:'2027-01-18',travellers:4,travellersSet:true}})});
 const select=owner.h.elements(n=>n.type==='select')[0];assert.equal(select.props.children.length,12,'1 to 12 travellers');
 await owner.h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await owner.h.flush();
 assert.equal(JSON.stringify(owner.calls[0].slice(2)),JSON.stringify([{start:'2027-01-15',end:'2027-01-18',travellers:4}]));
 assert.match(owner.h.text(),/Trip details saved for everyone/);
});
