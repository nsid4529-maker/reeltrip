import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,browserGlobals,memoryStorage} from './helpers/component-harness.mjs';
import {addReels,LIBRARY_KEY,readLibrary} from '../lib/reel-library.ts';
import {ANALYSIS_KEY} from '../lib/analysis-cache.ts';

const url='https://www.instagram.com/reel/UploadRetry/';
const reel={...addReels([],[url])[0],autoAnalyse:false};
async function setup(storageFailure=false){
 const error={status:'error',message:'Previous connection failed',updatedAt:Date.now()};
 const storage=memoryStorage({[LIBRARY_KEY]:JSON.stringify([reel]),[ANALYSIS_KEY]:JSON.stringify({[reel.id]:error})});
 const calls=[];
 const background={cache:{[reel.id]:error},restore:rows=>calls.push(['restore',rows]),ensure:(saved,retry)=>{calls.push(['ensure',saved,retry,readLibrary(storage.getItem(LIBRARY_KEY))]);return Promise.reject(new Error('Offline'));}};
 const h=await componentHarness('components/reel-upload.tsx',{globals:browserGlobals({storage}),modules:{
  '@/components/trip-buckets':{useTrips:()=>({activeId:'',ready:true,trips:[]})},
  '@/components/use-trip-sources':{useTripSources:()=>({ready:true,reels:[reel],bundles:[]})},
  '@/components/use-reel-analysis':{useReelAnalysis:()=>background},
 }});
 h.globals.window.dispatchEvent(new CustomEvent('reeltrip:open-upload',{detail:{link:url}}));h.render();calls.length=0;
 if(storageFailure)storage.setItem=()=>{throw new Error('Quota');};
 return {h,calls,storage};
}
test('saving an existing failed reel with Save and analyse starts an explicit retry after persistence',async()=>{
 const {h,calls,storage}=await setup();
 try{
  await h.elements(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
  const submitted=calls.filter(row=>row[0]==='ensure');assert.equal(submitted.length,1);
  assert.equal(submitted[0][1].id,reel.id);assert.equal(submitted[0][2],true);assert.equal(submitted[0][3][0].autoAnalyse,true);
  assert.equal(calls[0][0],'restore');assert.equal(readLibrary(storage.getItem(LIBRARY_KEY)).length,1);
  assert.match(h.text(),/Analysis needs attention/);
 }finally{h.unmount();}
});
test('Save only retains a failed reel without retrying its analysis',async()=>{
 const {h,calls,storage}=await setup();
 try{
  h.elements(node=>node.type==='input'&&node.props.type==='radio')[1].props.onChange();h.render();
  await h.elements(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
  assert.equal(calls.filter(row=>row[0]==='ensure').length,0);
  assert.equal(readLibrary(storage.getItem(LIBRARY_KEY))[0].autoAnalyse,false);
 }finally{h.unmount();}
});
test('a failed library save does not start analysis or discard the existing reel',async()=>{
 const {h,calls,storage}=await setup(true),before=storage.getItem(LIBRARY_KEY);
 try{
  await h.elements(node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await h.flush();
  assert.equal(calls.filter(row=>row[0]==='ensure').length,0);assert.equal(storage.getItem(LIBRARY_KEY),before);
  assert.match(h.text(),/could not be saved/);
 }finally{h.unmount();}
});
