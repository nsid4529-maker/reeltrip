import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';
const id='00000000-0000-4000-8000-0000000000a9';
const place={id:'p1',title:'Temple',place:'Kyoto',category:'Experiences',quote:'Temple',second:2,up:1,down:0,myVote:1};
async function render(extra={}){
 const calls=[],client=await import('../lib/shared-client.ts');
 const reel={id:'r1',key:'instagram-example',url:'https://www.instagram.com/reel/example/',addedBy:{id:'m1',name:'Mei'},addedAt:1,status:'ready',title:'Kyoto',creator:'A creator',platform:'Instagram',message:'',places:[place],canRemove:true,...extra};
 const bucket={id,name:'Kyoto',updatedAt:1,me:{id:'m1',name:'Mei',role:'owner'},members:[{id:'m1',name:'Mei',role:'owner'}],maxMembers:6,reels:[reel],invites:[],trip:{start:null,end:null,travellers:1,travellersSet:false},shortlist:null};
 const globals=browserGlobals();Object.assign(globals,{setInterval:()=>0,clearInterval(){},addEventListener(){},removeEventListener(){}});
 const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'SharedBucketView',props:{id},modules:{'@/lib/track':{track(){}},'@/lib/shared-client':{...client,getShared:async()=>bucket,addSharedReel:async(...args)=>{calls.push(args);return {id:reel.id,added:false};}}}});
 await h.flush();return {h,calls};
}
test('partial results retain usable cards, creator attribution and an explicit refresh action',async()=>{
 const {h,calls}=await render({omittedDetails:7});
 assert.match(h.text(),/Partial result · 7 details couldn’t be verified/);assert.match(h.text(),/Temple/);assert.match(h.text(),/A creator/);
 assert.equal(h.elements(n=>n.type==='a'&&n.props.href==='https://www.instagram.com/reel/example/').length,1);
 await h.elements(n=>n.type==='button'&&h.text(n)==='Check reel again')[0].props.onClick();await h.flush();
 assert.equal(JSON.stringify(calls),JSON.stringify([[id,'https://www.instagram.com/reel/example/',true]]));
});
test('empty results distinguish omitted unverified details from no identified places',async()=>{
 const partial=await render({places:[],omittedDetails:7});assert.match(partial.h.text(),/couldn’t identify any places confidently enough to list/);assert.doesNotMatch(partial.h.text(),/No places were found/);
 const empty=await render({places:[]});assert.match(empty.h.text(),/No specific places were identified/);assert.doesNotMatch(empty.h.text(),/Partial result/);
});
test('saved places stay visible and refresh is disabled while their update is running',async()=>{
 const {h}=await render({status:'analysing',message:'Checking this reel again. Your saved places are still shown.'});
 assert.match(h.text(),/saved places are still shown/);assert.match(h.text(),/Temple/);
 assert.equal(h.elements(n=>n.type==='button'&&/Check reel again|Try again/.test(h.text(n))).length,0);
});
