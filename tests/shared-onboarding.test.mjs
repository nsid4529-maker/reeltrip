import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals} from './helpers/component-harness.mjs';

// First-run onboarding: a new organiser gets from nothing to a booking link unaided.
const BID='00000000-0000-4000-8000-0000000000b1';
const bucket=(extra={})=>({id:BID,name:'Lisbon',updatedAt:1,me:{id:'m1',name:'Mei',role:'owner'},members:[{id:'m1',name:'Mei',role:'owner'}],maxMembers:6,
 reels:[],invites:[],trip:{start:null,end:null,travellers:1,travellersSet:false},shortlist:null,...extra});
async function render(name,props,client={},globals=browserGlobals()){
 const real=await import('../lib/shared-client.ts');
 const h=await componentHarness('components/shared-bucket.tsx',{globals,expose:['GettingStarted','CopyLink'],exportName:name,props,modules:{'@/lib/track':{track(){}},'@/lib/shared-client':{...real,...client}}});
 await h.flush();return h;
}

test('the guide ticks each step from the bucket itself, in order',async()=>{
 const h=await render('GettingStarted',{bucket:bucket()});
 assert.deepEqual(h.elements(n=>n.type==='li').map(li=>li.props.className),['is-next','','','','',''],'a new bucket starts at Invite your group');
 assert.match(h.text(),/Make an invite link and send it to your group chat/);
 assert.match(h.text(),/In Instagram or TikTok tap Share → Copy link/);
 assert.match(h.text(),/ReelTrip shows no prices and books nothing/);
 assert.ok(h.elements(n=>n.type==='a'&&n.props.href==='/privacy').length,'links to the privacy notice');
});

test('steps complete as the group invites, adds, votes, sets dates and agrees',async()=>{
 const place=(myVote)=>({id:'p',title:'Café',place:'Ella',category:'Food',quote:'',second:0,up:1,down:0,myVote});
 const states=[
  [bucket({members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}]}),['is-done','is-next','','','','']],
  [bucket({members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}],reels:[{id:'r',places:[place(0)]}]}),['is-done','is-done','is-next','','','']],
  [bucket({members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}],reels:[{id:'r',places:[place(1)]}]}),['is-done','is-done','is-done','is-next','','']],
  [bucket({members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}],reels:[{id:'r',places:[place(1)]}],trip:{start:'2027-05-01',end:'2027-05-04',travellers:2,travellersSet:true}}),['is-done','is-done','is-done','is-done','is-next','']],
  [bucket({members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}],reels:[{id:'r',places:[place(1)]}],trip:{start:'2027-05-01',end:'2027-05-04',travellers:2,travellersSet:true},shortlist:{by:{id:'m2',name:'Ana'},at:1}}),['is-done','is-done','is-done','is-done','is-done','is-next']],
 ];
 for(const [b,expected] of states){const h=await render('GettingStarted',{bucket:b});assert.deepEqual(h.elements(n=>n.type==='li').map(li=>li.props.className),expected);}
});

test('a member who is not the owner is told who sets the dates',async()=>{
 const h=await render('GettingStarted',{bucket:bucket({me:{id:'m2',name:'Ana',role:'editor'},members:[{id:'m1',name:'Mei',role:'owner'},{id:'m2',name:'Ana',role:'editor'}]})});
 assert.match(h.text(),/Mei sets the dates and travellers/);
});

test('hiding the tips is remembered for that bucket on this device',async()=>{
 const globals=browserGlobals();
 const h=await render('GettingStarted',{bucket:bucket()},{},globals);
 h.elements(n=>n.type==='button'&&h.text(n)==='Hide these tips')[0].props.onClick();await h.flush();
 assert.equal(h.text(),'Show these tips');
 assert.deepEqual(JSON.parse(globals.localStorage.getItem('reeltrip-guide-hidden-v1')),[BID]);
 const again=await render('GettingStarted',{bucket:bucket()},{},globals);assert.equal(again.text(),'Show these tips');
 assert.equal(again.elements(n=>n.props?.id==='shared-guide-heading').length,1,'the shared help link still has a target');
 again.elements(n=>n.type==='button')[0].props.onClick();await again.flush();
 assert.match(again.text(),/How this works/);
 assert.deepEqual(JSON.parse(globals.localStorage.getItem('reeltrip-guide-hidden-v1')),[]);
});

test('shared headers keep the group flow and use its guide while personal headers retain upload and bucket controls',async()=>{
 const renderHeader=props=>componentHarness('components/workspace-navigation.tsx',{exportName:'WorkspaceHeader',props});
 const shared=await renderHeader({active:'shared'});
 assert.doesNotMatch(shared.text(),/Upload reel|New bucket/);
 assert.equal(shared.elements(n=>n.type?.displayName==='TripPicker').length,0);
 assert.equal(shared.elements(n=>n.type==='a'&&shared.text(n)==='How it works')[0].props.href,'/shared');
 const bucketHeader=await renderHeader({active:'shared',helpHref:'#shared-guide-heading'});
 assert.equal(bucketHeader.elements(n=>n.type==='a'&&bucketHeader.text(n)==='How it works')[0].props.href,'#shared-guide-heading');
 const personal=await renderHeader({active:'library'});
 assert.match(personal.text(),/Upload reel/);assert.match(personal.text(),/New bucket/);
 assert.equal(personal.elements(n=>n.type?.displayName==='TripPicker').length,1);
 assert.equal(personal.elements(n=>n.type==='a'&&personal.text(n)==='How it works')[0].props.href,'/?help=1');
});

test('every invite link says what it does and how long it lasts',async()=>{
 const h=await render('CopyLink',{url:'https://x.test/join#'+'a'.repeat(64)});
 assert.match(h.text(),/type a name, no app, account or password\. It works for 14 days and for up to 6 people/);
});

test('bucket errors say what to do next',async()=>{
 const real=await import('../lib/shared-client.ts'),{SharedError}=real;
 const view=async e=>{const globals=browserGlobals();Object.assign(globals,{setInterval:()=>0,clearInterval(){},addEventListener(){},removeEventListener(){}});const w=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'SharedBucketView',props:{id:BID},modules:{'@/lib/track':{track(){}},'@/lib/shared-client':{...real,getShared:async()=>{throw e;}}}});await w.flush();return w.text();};
 assert.match(await view(new SharedError('Add your name on this device first.',401)),/Join this bucket on this device first.*Open the invite link you were sent on this device/);
 assert.match(await view(new SharedError('not found',404)),/We couldn’t find this bucket.*ask whoever invited you for a new link/);
 assert.match(await view(new SharedError('You seem to be offline.',0)),/You seem to be offline/);
 assert.match(await view(new SharedError('Today’s request limit has been reached. Please try again later.',429)),/request limit.*Reload the page/);
});

test('starting a group trip makes the member, then the bucket, then opens it',async()=>{
 const calls=[],globals=browserGlobals();globals.location={assign:url=>calls.push(['go',url])};
 const h=await render('StartGroupTrip',{member:null},{becomeMember:async n=>{calls.push(['member',n]);return {id:'m1',name:n};},createShared:async(n,urls)=>{calls.push(['bucket',n,urls]);return {id:BID,name:n,skipped:0};}},globals);
 const nameField=h.elements(n=>n.type?.name==='NameField');assert.equal(nameField.length,1,'asks for your name on a new device');
 h.elements(n=>n.type==='input')[0].props.onChange({target:{value:'Lisbon in May'}});nameField[0].props.onChange('Mei');await h.flush();
 await h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
 assert.equal(JSON.stringify(calls),JSON.stringify([['member','Mei'],['bucket','Lisbon in May',[]],['go','/shared?id='+BID]]));
 const known=await render('StartGroupTrip',{member:{name:'Mei'}});
 assert.equal(known.elements(n=>n.type?.name==='NameField').length,0,'a device that already has a name is not asked again');
 assert.match(known.text(),/You’ll be the owner, as Mei/);
});

test('a failed start keeps the form and says why',async()=>{
 const {SharedError}=await import('../lib/shared-client.ts');
 const h=await render('StartGroupTrip',{member:{name:'Mei'}},{createShared:async()=>{throw new SharedError('You can own up to 20 shared buckets.',409);}});
 h.elements(n=>n.type==='input')[0].props.onChange({target:{value:'Rome'}});await h.flush();
 await h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
 assert.match(h.text(),/You can own up to 20 shared buckets/);
 assert.equal(h.elements(n=>n.type==='button')[0].props.disabled,false);
});

test('an uncertain bucket creation offers recovery and blocks an immediate duplicate submission',async()=>{
 const {SharedError}=await import('../lib/shared-client.ts');
 for(const component of ['StartGroupTrip','ShareThisBucket']){
  let calls=0;
  const client={me:async()=>({id:'m1',name:'Mei'}),createShared:async()=>{calls++;throw new SharedError('Your shared bucket may already have been created. Check your shared buckets before creating another.',408,true);}};
  const props=component==='StartGroupTrip'?{member:{name:'Mei'}}:{tripId:'personal-1',name:'Sri Lanka',reelUrls:[]};
  const h=await render(component,props,client);
  if(component==='StartGroupTrip'){h.elements(n=>n.type==='input')[0].props.onChange({target:{value:'Sri Lanka'}});await h.flush();}
  await h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
  assert.equal(h.elements(n=>n.type==='a'&&n.props.href==='/shared'&&h.text(n)==='Check your shared buckets').length,1,component);
  assert.equal(h.elements(n=>n.type==='button'&&n.props.type==='submit')[0].props.disabled,true,component);
  await h.elements(n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
  assert.equal(calls,1,'checking the existing bucket comes before creating another');
 }
});

test('adding a reel in a shared bucket records reel_added for that bucket, once',async()=>{
 const real=await import('../lib/shared-client.ts'),tracked=[];
 const globals=browserGlobals();Object.assign(globals,{setInterval:()=>0,clearInterval(){},addEventListener(){},removeEventListener(){}});
 let added=true;
 const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'SharedBucketView',props:{id:BID},modules:{'@/lib/track':{track:(...a)=>tracked.push(a)},'@/lib/shared-client':{...real,getShared:async()=>bucket(),addSharedReel:async()=>({id:'r',added})}}});
 await h.flush();
 assert.match(h.text(),/AI finds places from each reel/);
 const submit=async url=>{h.elements(n=>n.type==='input'&&n.props.id==='shared-reel-link')[0].props.onChange({target:{value:url}});await h.flush();await h.elements(n=>n.type==='form'&&h.text(n).includes('Add for everyone'))[0].props.onSubmit({preventDefault(){}});await h.flush();};
 await submit('https://www.tiktok.com/@a/video/1');
 assert.equal(JSON.stringify(tracked),JSON.stringify([['reel_added',{source:'link',platform:'TikTok',destination:'trip',analyse:true},BID]]));
 added=false;await submit('https://www.tiktok.com/@a/video/1');
 assert.equal(tracked.length,1,'a reel already in the bucket is not counted again');
});

test('a reel whose analysis failed can be tried again by any member',async()=>{
 const real=await import('../lib/shared-client.ts'),calls=[];
 const globals=browserGlobals();Object.assign(globals,{setInterval:()=>0,clearInterval(){},addEventListener(){},removeEventListener(){}});
 const failed={id:'r1',key:'k',url:'https://www.instagram.com/reel/abc/',addedBy:{id:'m1',name:'Mei'},addedAt:1,status:'unavailable',title:'',creator:'',platform:'',message:'Analysis could not be started. Try again later.',places:[],canRemove:false};
 const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'SharedBucketView',props:{id:BID},modules:{'@/lib/track':{track(){}},'@/lib/shared-client':{...real,getShared:async()=>bucket({me:{id:'m2',name:'Ana',role:'editor'},reels:[failed]}),addSharedReel:async(...a)=>{calls.push(a);return {id:'r1',added:false};}}}});
 await h.flush();
 const retry=h.elements(n=>n.type==='button'&&h.text(n)==='Try again');assert.equal(retry.length,1);
 await retry[0].props.onClick();await h.flush();
 assert.deepEqual(calls,[[BID,'https://www.instagram.com/reel/abc/',true]]);assert.match(h.text(),/Checking that reel again for everyone/);
});

test('vote buttons say Keep and Skip, not just a number',async()=>{
 const real=await import('../lib/shared-client.ts');
 const h=await componentHarness('components/shared-bucket.tsx',{expose:['Vote'],exportName:'Vote',props:{bucketId:BID,place:{id:'p',title:'Café',up:2,down:1,myVote:0},onChanged(){}},modules:{'@/lib/track':{track(){}},'@/lib/shared-client':real}});
 await h.flush();
 assert.deepEqual(h.elements(n=>n.type==='button').map(b=>h.text(b)),['Keep · 2','Skip · 1']);
 assert.deepEqual(h.elements(n=>n.type==='button').map(b=>b.props['aria-label']),['Keep, 2 votes','Skip, 1 vote']);
});

test('a full bucket tells the seventh person plainly, without promising a way in',async()=>{
 const real=await import('../lib/shared-client.ts'),globals=browserGlobals();
 globals.location={hash:'#'+'c'.repeat(64)};
 const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'JoinInvite',modules:{'@/lib/track':{track(){}},'@/lib/native-library':{hasNativeBridge:()=>false},'@/lib/shared-client':{...real,previewInvite:async()=>({bucketName:'Hen do',ownerName:'Gita',members:6,maxMembers:6,full:true,me:null,alreadyMember:false})}}});
 await h.flush();await h.flush();
 assert.match(h.text(),/already has 6 people, the most a shared bucket can hold/);
 assert.doesNotMatch(h.text(),/make room/);
 assert.equal(h.elements(n=>n.type==='form').length,0,'no join form');
});

test('an invite uses has for one joined person and have for a group',async()=>{
 for(const members of [1,2]){
  const real=await import('../lib/shared-client.ts'),globals=browserGlobals();globals.location={hash:'#'+'d'.repeat(64)};
  const h=await componentHarness('components/shared-bucket.tsx',{globals,exportName:'JoinInvite',modules:{'@/lib/track':{track(){}},'@/lib/native-library':{hasNativeBridge:()=>false},'@/lib/shared-client':{...real,previewInvite:async()=>({bucketName:'Lisbon',members,maxMembers:6,full:false,me:null,alreadyMember:false})}}});
  await h.flush();await h.flush();
  assert.match(h.text(),members===1?/1 of 6 people has joined/:/2 of 6 people have joined/);
 }
});
