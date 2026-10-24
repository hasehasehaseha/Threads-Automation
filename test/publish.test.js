import test from 'node:test';import assert from 'node:assert/strict';
import {publishClaim,immediateReady} from '../src/publish.js';
const env={THREADS_ACCESS_TOKEN:'secret',IMMEDIATE_ENABLED:'true'},post={id:'p',claim_id:'c',body:'本文'};
test('immediate publishing requires both explicit enable and token',()=>{
 assert.equal(immediateReady(env),true);assert.equal(immediateReady({...env,IMMEDIATE_ENABLED:'false'}),false);assert.equal(immediateReady({IMMEDIATE_ENABLED:'true'}),false);
});
test('publish uses claimed body and reports numeric published id',async t=>{
 const paths=[];let callback;
 t.mock.method(globalThis,'fetch',async(url,options)=>{paths.push(url);assert.equal(options.headers.Authorization,'Bearer secret');if(paths.length===1){assert.equal(options.body.get('text'),'本文');return Response.json({id:'100'});}if(paths.length===2)return Response.json({status:'FINISHED'});return Response.json({id:'200'});});
 const result=await publishClaim(env,post,async(e,p,m,b)=>{if(p==='rpc/complete_claim')callback=b;});
 assert.equal(paths.length,3);assert.equal(result.status,'published');assert.equal(callback.p_meta_id,'200');assert.equal(callback.p_claim,'c');
});
test('uncertain publication never retries the external publish request',async t=>{
 let writes=0;const results=[];
 t.mock.method(globalThis,'fetch',async(url)=>{if(url.endsWith('/threads'))return Response.json({id:'100'});if(url.includes('?fields='))return Response.json({status:'FINISHED'});writes++;throw new Error('timeout');});
 await assert.rejects(publishClaim(env,post,async(e,p,m,b)=>{if(p==='rpc/complete_claim')results.push(b);}),/再投稿せず/);
 assert.equal(writes,1);assert.equal(results[0].p_status,'needs_review');
});
test('incomplete container is not published',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>Response.json(++calls===1?{id:'100'}:{status:'IN_PROGRESS'}));
 await assert.rejects(publishClaim(env,post,async()=>{},{wait:async()=>{}}));assert.equal(calls,6);
});
test('container preparation is polled without repeating creation or publication',async t=>{
 let creates=0,reads=0,publishes=0,waits=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.endsWith('/threads')){creates++;return Response.json({id:'100'});}
  if(url.includes('?fields=')){reads++;return Response.json({status:reads<3?'IN_PROGRESS':'FINISHED'});}
  publishes++;return Response.json({id:'200'});
 });
 await publishClaim(env,post,async()=>{},{wait:async()=>{waits++;}});
 assert.equal(creates,1);assert.equal(reads,3);assert.equal(publishes,1);assert.equal(waits,2);
});
test('pre-publication failure records safe stage diagnostics',async t=>{
 const updates=[];
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:{code:190,message:'DO NOT SAVE SECRET'}},{status:401}));
 await assert.rejects(publishClaim(env,post,async(e,path,method,body)=>{updates.push({path,method,body});}));
 const saved=updates.find(x=>x.method==='PATCH').body.last_error;
 assert.match(saved,/create/);assert.match(saved,/code 190/);assert.ok(!saved.includes('SECRET'));
});
