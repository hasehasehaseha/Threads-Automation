import test from 'node:test';import assert from 'node:assert/strict';import worker,{validatePost,isReady} from '../src/worker.js';
test('JST schedule converts to UTC regardless of host timezone',()=>{assert.equal(validatePost({body:'教室紹介',planned:'2026-10-24T08:00'}).p_at,'2026-10-23T23:00:00.000Z');});
test('reject empty, excessive and ambiguous datetime input',()=>{for(const d of [{body:' '},{body:'あ'.repeat(501)},{body:'a',planned:'2026-10-24T08:00Z'}])assert.throws(()=>validatePost(d));assert.equal(validatePost({body:'😀'.repeat(500)}).p_body.length,1000);});
test('unconfigured API fails closed',async()=>{const r=await worker.fetch(new Request('https://example.com/api/state'),{});assert.equal(r.status,503);assert.equal(isReady({}),false);});
test('config never exposes service-role key',async()=>{const r=await worker.fetch(new Request('https://example.com/api/config'),{SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret'});const body=await r.text();assert.ok(!body.includes('secret'));});
test('cross origin writes refused before database access',async()=>{const r=await worker.fetch(new Request('https://example.com/api/posts',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),{SUPABASE_URL:'x',SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x'});assert.equal(r.status,403);});
test('missing staff token cannot read data',async()=>{const r=await worker.fetch(new Request('https://example.com/api/state'),{SUPABASE_URL:'x',SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x'});assert.equal(r.status,401);});
const automationEnv={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'db-secret',MAKE_API_TOKEN:'m'.repeat(48),AUTOMATION_ENABLED:'true'};
const makeRequest=(path,body={},token=automationEnv.MAKE_API_TOKEN)=>new Request('https://example.com/api/automation/'+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
test('automation rejects staff tokens and remains disabled until explicitly enabled',async()=>{
 assert.equal((await worker.fetch(makeRequest('claim',{},'staff-token'),automationEnv)).status,401);
 assert.equal((await worker.fetch(makeRequest('claim'),{...automationEnv,AUTOMATION_ENABLED:'false'})).status,409);
 assert.equal((await worker.fetch(makeRequest('claim'),{...automationEnv,MAKE_API_TOKEN:''})).status,503);
});
test('claim sends no database credential or staff data to Make',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.ok(url.endsWith('/rpc/claim_due_post'));assert.equal(options.method,'POST');return Response.json([{id:'post',claim_id:'claim',body:'本文',scheduled_at:'date',created_by:'private-user',approved_by:'private-admin'}]);});
 const r=await worker.fetch(makeRequest('claim'),automationEnv);assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{post:{id:'post',claim_id:'claim',body:'本文',scheduled_at:'date'}});
});
test('publishing result requires a valid claim and numeric Meta id',async()=>{
 for(const body of [{},{id:'invalid',claim_id:'invalid',status:'published'},{id:'12345678-1234-1234-1234-123456789012',claim_id:'12345678-1234-1234-1234-123456789012',status:'published',meta_post_id:'https://example.com'}])assert.equal((await worker.fetch(makeRequest('result',body),automationEnv)).status,400);
});
