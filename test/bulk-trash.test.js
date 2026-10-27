import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/worker.js';import {validateBulkTrash} from '../src/bulk-trash.js';
const id='12345678-1234-1234-1234-123456789012';
test('bulk trash validates exact versioned selection and rejects duplicate/oversized batches',()=>{
 assert.deepEqual(validateBulkTrash({request_id:id,posts:[{id,version:1}]}),{p_request:id,p_ids:[id],p_versions:[1]});
 for(const posts of [[],[{id,version:0}],[{id,version:1},{id,version:1}],Array.from({length:101},()=>({id,version:1}))])assert.throws(()=>validateBulkTrash({request_id:id,posts}),/移動対象/);
});
test('only administrators and same-origin requests may call bulk trash RPC',async t=>{
 let role='editor',calls=[];const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private'};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{if(url.endsWith('/auth/v1/user'))return Response.json({id:'actor'});if(url.includes('/members?'))return Response.json([{user_id:'actor',role}]);calls.push({url,body:JSON.parse(opts.body)});return Response.json({moved:1});});
 const send=(origin='https://studio.example')=>worker.fetch(new Request('https://studio.example/api/posts/bulk-trash',{method:'POST',headers:{Origin:origin,Authorization:'Bearer staff'},body:JSON.stringify({request_id:id,posts:[{id,version:1}]})}),env);
 assert.equal((await send()).status,403);assert.equal(calls.length,0);role='admin';assert.equal((await send()).status,200);assert.ok(calls[0].url.endsWith('/rpc/trash_drafts_bulk'));assert.deepEqual(calls[0].body.p_ids,[id]);assert.deepEqual(calls[0].body.p_versions,[1]);
 assert.equal((await send('https://evil.example')).status,403);assert.equal(calls.length,1);
});
