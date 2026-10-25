import test from 'node:test';import assert from 'node:assert/strict';
import {validateApprovalPreview,validateBulkApproval} from '../src/bulk-approval.js';import worker from '../src/worker.js';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('preview allows explicit counts up to100 or an inclusive future date',()=>{
 for(const count of [1,10,100])assert.deepEqual(validateApprovalPreview({mode:'count',count}),{p_limit:count,p_end:null});
 assert.deepEqual(validateApprovalPreview({mode:'date',end_date:'2099-10-30'}),{p_limit:100,p_end:'2099-10-30'});
 for(const data of [{mode:'all'},{mode:'count',count:101},{mode:'count',count:0},{mode:'count',count:1.5},{mode:'count',count:'10'},{mode:'date',end_date:'2099-02-30'}])assert.throws(()=>validateApprovalPreview(data));
});
test('apply uses exact reviewed IDs and versions, never an open-ended date query',()=>{
 const posts=[{id,version:2},{id:other,version:3}];assert.deepEqual(validateBulkApproval({request_id:id,posts}),{p_request:id,p_ids:[id,other],p_versions:[2,3]});
 for(const data of [{request_id:id,posts:[]},{request_id:'bad',posts},{request_id:id,posts:[posts[0],posts[0]]},{request_id:id,posts:[{id,version:0}]},{request_id:id,posts:Array(101).fill(posts[0])}])assert.throws(()=>validateBulkApproval(data));
});
test('only admins can preview or approve, staff cannot reach either RPC',async t=>{
 let role='editor',calls=[];const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private'};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'actor'});
  if(url.includes('/members?'))return Response.json([{user_id:'actor',role}]);
  calls.push({url,body:JSON.parse(opts.body)});return Response.json({approved:1});
 });
 const send=(path,data,origin='https://studio.example')=>worker.fetch(new Request('https://studio.example/api/posts/'+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer staff'},body:JSON.stringify(data)}),env);
 const selection={request_id:id,posts:[{id,version:1}]};
 assert.equal((await send('bulk-preview',{mode:'count',count:10})).status,403);assert.equal((await send('bulk-approve',selection)).status,403);assert.equal(calls.length,0);
 role='admin';assert.equal((await send('bulk-preview',{mode:'count',count:100})).status,200);assert.ok(calls[0].url.endsWith('/preview_bulk_approval'));assert.equal(calls[0].body.p_actor,'actor');
 assert.equal((await send('bulk-approve',selection)).status,200);assert.ok(calls[1].url.endsWith('/approve_bulk_posts'));assert.deepEqual(calls[1].body.p_ids,[id]);
 assert.equal((await send('bulk-approve',selection,'https://evil.example')).status,403);assert.equal(calls.length,2);
});
