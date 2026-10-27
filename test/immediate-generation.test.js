import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'fixture',AI_HISTORY_ENABLED:'true',OPENAI_API_KEY:'fixture'};
const send=(origin='https://studio.example')=>new Request('https://studio.example/api/generate-start',{method:'POST',headers:{Origin:origin,Authorization:'Bearer fixture'},body:'{}'});
test('staff button starts a paid generation directly, uses the shared claim and cannot repeat a completed job',async t=>{
 let claimed=false,paid=0,completed=0;const tasks=[],calls=[];
 const job={id:'11111111-1111-4111-8111-111111111111',claim_id:'claim',kind:'production',target_date:'2099-11-01',settings_snapshot:{},prompt_snapshot:{mode:'production',count:1,times:['08:00'],templates:[]}};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'staff'});
  if(url.includes('/members?'))return Response.json([{user_id:'staff',role:'editor',active:true}]);
  if(url.endsWith('/rpc/claim_history_generation_job')){if(claimed)return Response.json([]);claimed=true;return Response.json([job]);}
  if(url.includes('/ai_config?'))return Response.json([{model:'gpt-6.1-sol'}]);
  if(url.endsWith('/rpc/ai_month_usage'))return Response.json({productionUsd:0});
  if(url.endsWith('/rpc/history_for_generation'))return Response.json([]);
  if(url.endsWith('/rpc/reserve_ai_call'))return Response.json(true);
  if(url.includes('/ai_usage?')||url.includes('/generation_jobs?'))return Response.json([]);
  if(url.endsWith('/responses')){
   paid++;const body=JSON.parse(opts.body);assert.ok(body.input.includes('2099-11-01T08:00:00+09:00'));
   return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({posts:[{topic:'確認',body:'親子で話し合う時間を大切に。'}]})}]}]});
  }
  if(url.endsWith('/embeddings'))return Response.json({data:[{index:0,embedding:Array(256).fill(.1)}],usage:{prompt_tokens:10}});
  if(url.endsWith('/rpc/complete_generation_job')){completed++;return Response.json({status:'completed'});}
  throw new Error('Unexpected fixture URL: '+url);
 });
 const first=await worker.fetch(send(),env,{waitUntil:p=>tasks.push(p)});
 assert.equal(first.status,200);assert.equal((await first.json()).status,'completed');assert.equal(paid,1);assert.equal(completed,1);
 const second=await worker.fetch(send(),env,{waitUntil:p=>tasks.push(p)});
 assert.equal((await second.json()).processed,false);assert.equal(paid,1);
 await Promise.all(tasks);assert.ok(!calls.some(u=>u.includes('threads')||u.includes('make.com')));
});
test('immediate generation rejects cross-origin, unauthenticated and unconfigured starts without paid calls',async t=>{
 let auth=true,claims=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.endsWith('/auth/v1/user'))return auth?Response.json({id:'staff'}):Response.json({}, {status:401});
  if(url.includes('/members?'))return Response.json([{user_id:'staff',role:'editor'}]);
  claims++;throw new Error('No paid/claim call allowed');
 });
 assert.equal((await worker.fetch(send('https://evil.example'),env)).status,403);
 auth=false;assert.equal((await worker.fetch(send(),env)).status,401);
 auth=true;assert.equal((await worker.fetch(send(),{...env,OPENAI_API_KEY:''})).status,503);
 assert.equal(claims,0);
});
