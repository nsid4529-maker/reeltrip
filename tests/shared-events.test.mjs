import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';

// member_joined fires once on a real join; vote_cast fires on up/down, not on clearing.
const bucketId='00000000-0000-4000-8000-0000000000e1',token='ab'.repeat(32);
function setup(overrides={}){
 const tracked=[],calls=[];
 const shared={previewInvite:async()=>({bucketName:'Lisbon',ownerName:'Aisha',members:1,maxMembers:6,full:false,me:null,alreadyMember:false}),
  joinShared:async(t,name)=>{calls.push(['join',t,name]);return {bucketId,joined:true,member:{id:'m',name}};},
  voteShared:async(...args)=>{calls.push(['vote',...args]);return {};},...overrides};
 const modules={'@/lib/track':{track:(...args)=>tracked.push(args)},'@/lib/shared-client':shared};
 return {tracked,calls,modules};
}
const submit=async h=>{const form=h.elements(n=>n.type==='form')[0];await form.props.onSubmit({preventDefault(){}});await h.flush();};

test('joining records member_joined with the bucket, then opens it',async()=>{
 const {tracked,calls,modules}=setup(),assigned=[];
 const globals=browserGlobals();globals.location={hash:'#'+token,assign:url=>assigned.push(url)};
 const h=await componentHarness('components/shared-bucket.tsx',{modules,globals,exportName:'JoinInvite'});
 await h.flush();
 h.elements(n=>n.props?.id==='join-name')[0].props.onChange('Ben');h.render();
 await submit(h);
 assert.deepEqual(calls,[['join',token,'Ben']]);
 assert.equal(JSON.stringify(tracked),JSON.stringify([['member_joined',{},bucketId]]));
 assert.deepEqual(assigned,['/shared?id='+bucketId]);
});

test('opening an invite you already accepted does not count as joining again',async()=>{
 const {tracked,modules}=setup({joinShared:async()=>({bucketId,joined:false,member:{id:'m',name:'Ben'}}),previewInvite:async()=>({bucketName:'Lisbon',ownerName:'Aisha',members:2,maxMembers:6,full:false,me:{name:'Ben'},alreadyMember:false})});
 const globals=browserGlobals();globals.location={hash:'#'+token,assign(){}};
 const h=await componentHarness('components/shared-bucket.tsx',{modules,globals,exportName:'JoinInvite'});
 await h.flush();await submit(h);
 assert.deepEqual(tracked,[]);
});

test('votes record vote_cast up or down; clearing a vote records nothing',async()=>{
 const {tracked,calls,modules}=setup();
 const place={id:'cafe-soul',title:'Café Soul',place:'Ella',category:'Food',quote:'',second:0,up:0,down:0,myVote:0};
 const vote=async(myVote,label)=>{const h=await componentHarness('components/shared-bucket.tsx',{modules,expose:['Vote'],exportName:'Vote',props:{bucketId,place:{...place,myVote},onChanged(){}}});const button=h.elements(n=>n.type==='button'&&n.props['aria-label']?.startsWith(label))[0];await button.props.onClick();await h.flush();};
 await vote(0,'Keep');await vote(0,'Skip');await vote(1,'Keep');
 assert.deepEqual(calls.map(c=>c[3]),[1,-1,0],'the third click clears the vote');
 assert.equal(JSON.stringify(tracked),JSON.stringify([['vote_cast',{placeId:'cafe-soul',vote:'up'},bucketId],['vote_cast',{placeId:'cafe-soul',vote:'down'},bucketId]]));
});
