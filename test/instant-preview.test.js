import test from 'node:test';import assert from 'node:assert/strict';
import {runImmediateTest,publicTestResult} from '../src/instant-preview.js';
import {validateTest} from '../src/prompts.js';import {generationPrompt} from '../src/generation.js';
const data={name:'共感',category:'保護者',instructions:'気持ちに寄り添う',brief:'今の興味を尊重する',request_id:'11111111-1111-4111-8111-111111111111'};
const env={OPENAI_API_KEY:'private-test-key'};
const output=JSON.stringify({posts:[{topic:'共感',body:'お子さまの興味を聞いてみませんか。'}]});
test('browser result excludes claims and private settings',()=>{
 assert.deepEqual(publicTestResult({id:'job',status:'completed',claim_id:'private',settings_snapshot:{private:'settings'},created_by:'actor',preview_posts:[]}),{id:'job',status:'completed',preview_posts:[]});
});
test('new test snapshot and preview request only one post',()=>{
 const s=validateTest(data);assert.equal(s.count,1);assert.equal(s.delivery,'direct');
 const prompt=generationPrompt({},s);assert.ok(prompt.includes('下書きを1件'));assert.ok(!prompt.includes('3件'));assert.ok(!prompt.includes('3案'));
});
test('instant test calls OpenAI once, stores only preview text and never posts to Threads or Make',async t=>{
 let called=0,completed=0,job;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  called++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(opts.headers.Authorization,'Bearer private-test-key');
  const body=JSON.parse(opts.body);assert.equal(body.model,'gpt-4.1-mini');assert.equal(body.store,false);assert.ok(body.input.includes('下書きを1件'));
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]});
 });
 const db=async(e,p,m,b)=>{
  if(p==='rpc/begin_immediate_prompt_test'){job={id:b.p_id,claim_id:b.p_claim,kind:'test',status:'generating',settings_snapshot:{facts:'校舎名'},prompt_snapshot:b.p_snapshot};return job;}
  assert.equal(p,'rpc/complete_generation_job');completed++;assert.equal(b.p_posts.length,1);return {...job,status:'completed',preview_posts:b.p_posts};
 };
 const result=await runImmediateTest(env,'actor',data,db);assert.equal(result.preview_posts.length,1);assert.equal(called,1);assert.equal(completed,1);
 assert.ok(!JSON.stringify(result).includes(env.OPENAI_API_KEY));
});
test('replay and missing key do not invoke paid generation',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('must not call');});
 const cached={status:'completed',claim_id:'old',preview_posts:[{body:'以前の結果'}]};
 assert.deepEqual(await runImmediateTest(env,'actor',data,async()=>cached),cached);
 await assert.rejects(runImmediateTest({},'actor',data,async()=>{throw new Error('must not write');}),/OpenAI接続/);
});
test('AI failures are safe, end the test and never retry',async t=>{
 let called=0,patch;
 t.mock.method(globalThis,'fetch',async()=>{called++;return new Response('private raw credential echo',{status:401});});
 const r=await runImmediateTest(env,'actor',data,async(e,p,m,b)=>{
  if(m==='POST')return {id:b.p_id,claim_id:b.p_claim,prompt_snapshot:b.p_snapshot,settings_snapshot:{}};
  assert.equal(m,'PATCH');patch=b;return [];
 });
 assert.equal(called,1);assert.equal(r.status,'needs_review');assert.equal(patch.status,'needs_review');assert.ok(!r.test_error.includes('credential echo'));
});
test('generated text stays in response if history save fails; OpenAI is not retried',async t=>{
 let called=0;
 t.mock.method(globalThis,'fetch',async()=>{called++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]});});
 const r=await runImmediateTest(env,'actor',data,async(e,p,m,b)=>{
  if(p==='rpc/begin_immediate_prompt_test')return {id:b.p_id,claim_id:b.p_claim,prompt_snapshot:b.p_snapshot,settings_snapshot:{}};
  throw new Error('database down');
 });
 assert.equal(called,1);assert.equal(r.historySaved,false);assert.equal(r.preview_posts.length,1);
});
