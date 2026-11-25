import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';
import {sharedPlaceAnchor} from '../lib/shared-plan.ts';

const place=(id,category)=>({id,title:id,category,place:'Kyoto',quote:'Visit '+id,second:0,up:1,down:0,myVote:1});
const reel=(id,places)=>({id,title:id,creator:'creator',url:'https://instagram.com/p/'+id+'/',addedBy:{id:'m',name:'QA'},status:'ready',places});
const bucket={id:'b',name:'QA',me:{id:'m',role:'owner'},members:[{id:'m',name:'QA',role:'owner'}],maxMembers:6,trip:{start:'2099-01-01',end:'2099-01-05',travellers:1},invites:[],reels:[reel('Mixed reel',[place('Cafe','Food'),place('Temple','Experiences'),place('Hotel','Stays')]),reel('Activity reel',[place('Tour','Experiences')])]};
async function setup(b=bucket){
 const globals=browserGlobals(),scrolled=[];
 Object.assign(globals,{setInterval:()=>0,clearInterval(){}});globals.document.getElementById=id=>({scrollIntoView:()=>scrolled.push(id)});
 const h=await componentHarness('components/shared-bucket.tsx',{exportName:'SharedBucketView',props:{id:b.id},globals,modules:{'@/lib/shared-client':{getShared:async()=>b},'@/lib/track':{track(){}}}});
 await h.flush();return {h,scrolled};
}
const cards=h=>h.elements(n=>n.type==='li'&&n.props.id?.startsWith('shared-place-')).map(n=>n.props.id);
async function filter(h,label){h.elements(n=>n.type==='button'&&h.text(n).startsWith(label+' ·'))[0].props.onClick();await h.flush();}

test('food and activity filters show counts and only matching source cards, preserving all shared data',async()=>{
 const {h}=await setup(),original=JSON.stringify(bucket);
 assert.equal(cards(h).length,4);
 await filter(h,'Food');assert.deepEqual(cards(h),[sharedPlaceAnchor('Cafe')]);assert.match(h.text(),/Showing 1 of 4 places/);
 assert.doesNotMatch(h.text(),/Activity reel/);
 const plan=h.elements(n=>n.type?.displayName==='SharedTripPlan')[0];assert.equal(plan.props.bucket,bucket);
 const map=h.elements(n=>n.type?.displayName==='BucketMap')[0];assert.equal(map.props.places.length,4);
 await filter(h,'Activities');assert.deepEqual(cards(h),[sharedPlaceAnchor('Temple'),sharedPlaceAnchor('Tour')]);
 await filter(h,'All');assert.equal(cards(h).length,4);assert.equal(JSON.stringify(bucket),original);
});

test('an empty category explains how to return to all results',async()=>{
 const {h}=await setup({...bucket,reels:[reel('Only activities',[place('Temple','Experiences')])]});
 await filter(h,'Food');assert.equal(cards(h).length,0);assert.match(h.text(),/No food spots found yet. Choose All/);
});

test('a plan evidence link clears the active filter before scrolling to its place',async()=>{
 const {h,scrolled}=await setup();await filter(h,'Food');assert.equal(cards(h).includes(sharedPlaceAnchor('Temple')),false);
 h.elements(n=>n.type?.displayName==='SharedTripPlan')[0].props.onRevealChoice('Temple');await h.flush();
 assert.equal(cards(h).length,4);assert.deepEqual(scrolled,[sharedPlaceAnchor('Temple')]);
});
