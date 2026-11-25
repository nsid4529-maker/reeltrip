import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseViatorTaxonomy,productMatchesDestination,createViatorTaxonomyCache} from '../lib/server/viator-destinations.ts';
const nodes=[
 {destinationId:4,lookupId:'2.4'},
 {destinationId:100,lookupId:'2.4.100'},
 {destinationId:60470,lookupId:'2.4.100.60470'},
 {destinationId:5446,lookupId:'6.10.5446'},
 {destinationId:479,lookupId:'6.11.479'},
];
const payload={destinations:nodes,totalCount:nodes.length};
const product=(...refs)=>({destinations:refs.map((ref,i)=>({ref,primary:i===0}))});
const config={environment:'production',key:'private-test-key'};

test('Scope accepts any exact or descendant destination, never unrelated sibling or substring IDs',()=>{
 const taxonomy=parseViatorTaxonomy(payload);
 assert.equal(productMatchesDestination(product('60470'),'60470',taxonomy),true);
 assert.equal(productMatchesDestination(product('60470'),'100',taxonomy),true);
 assert.equal(productMatchesDestination(product('60470'),'4',taxonomy),true);
 assert.equal(productMatchesDestination(product('5446','60470'),'60470',taxonomy),true);
 assert.equal(productMatchesDestination(product('60470'),'5446',taxonomy),false);
 assert.equal(productMatchesDestination(product('479'),'4',taxonomy),false);
 assert.equal(productMatchesDestination(product('100'),'60470',taxonomy),false);
 for(const item of [{},product('999999'),{destinations:[{ref:60470}]},{destinations:[null]},product()])assert.equal(productMatchesDestination(item,'60470',taxonomy),false);
 assert.equal(productMatchesDestination(product('60470'),'999999',taxonomy),false);
});

test('Taxonomy rejects incomplete, excessive, duplicate or malformed ID lineage',()=>{
 for(const value of [null,{}, {...payload,totalCount:100}, {destinations:Array(20001).fill(nodes[0]),totalCount:20001}, {destinations:[nodes[0],nodes[0]],totalCount:2}, {destinations:[{destinationId:479,lookupId:'6.11.1479'}],totalCount:1}, {destinations:[{destinationId:479,lookupId:'6.11.6.479'}],totalCount:1}, {destinations:[{destinationId:479,lookupId:'6.evil.479'}],totalCount:1}])assert.throws(()=>parseViatorTaxonomy(value),/could not be verified/);
});

test('Taxonomy cache deduplicates loads, separates environments and refreshes after seven days',async()=>{
 let now=0,calls=0,quota=0;
 const load=createViatorTaxonomyCache(()=>now);
 const fetcher=async(url,options)=>{
  calls++;assert.ok(['https://api.viator.com/partner/destinations','https://api.sandbox.viator.com/partner/destinations'].includes(url));
  assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.headers['exp-api-key'],'private-test-key');
  return Response.json(payload);
 };
 const before=async()=>{quota++;};
 const [first,second]=await Promise.all([load(config,before,fetcher),load(config,before,fetcher)]);
 assert.equal(first,second);assert.equal(calls,1);assert.equal(quota,1);
 await load(config,before,fetcher);assert.equal(calls,1);
 await load({...config,environment:'sandbox'},before,fetcher);assert.equal(calls,2);
 now=7*86400000;
 await load(config,before,fetcher);assert.equal(calls,3);assert.equal(quota,3);
});

test('Failed refresh never returns expired taxonomy or an unverified fallback and can recover',async()=>{
 let now=0,calls=0;
 const load=createViatorTaxonomyCache(()=>now);
 await load(config,async()=>{},async()=>{calls++;return Response.json(payload);});
 now=7*86400000;
 for(const response of [new Response(null,{status:302,headers:{Location:'https://evil.example'}}),new Response(null,{status:500}),Response.json({destinations:[]})])await assert.rejects(load(config,async()=>{},async()=>{calls++;return response;}),/could not be verified/);
 const restored=await load(config,async()=>{},async()=>{calls++;return Response.json(payload);});
 assert.equal(restored.has('60470'),true);assert.equal(calls,5);
});

test('Taxonomy byte limits and quota denial fail before any location data is accepted',async()=>{
 let calls=0;
 await assert.rejects(createViatorTaxonomyCache()(config,async()=>{throw Error('quota denied');},async()=>{calls++;return Response.json(payload);}),/quota denied/);
 assert.equal(calls,0);
 await assert.rejects(createViatorTaxonomyCache()(config,async()=>{},async()=>new Response('{}',{headers:{'content-length':'5000001'}})),/invalid response/);
 await assert.rejects(createViatorTaxonomyCache()({...config,environment:'evil'},async()=>{},async()=>{calls++;return Response.json(payload);}),/could not be verified/);
 assert.equal(calls,0);
});
