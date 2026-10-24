import test from 'node:test';import assert from 'node:assert/strict';
import {validateTemplate,validateTest} from '../src/prompts.js';
import {generationPrompt,generationAutomation} from '../src/generation.js';
import worker from '../src/worker.js';
const template={name:'共感を生む投稿',category:'共感',instructions:'保護者の迷いに寄り添う問いかけを入れる'};
test('prompt validation bounds free text and test input never implies publication',()=>{
 assert.equal(validateTemplate(template).active,true);
 for(const p of [{...template,name:''},{...template,instructions:'x'.repeat(6001)},{...template,category:'x'.repeat(61)}])assert.throws(()=>validateTemplate(p));
 const snapshot=validateTest({...template,brief:'初めての習い事'});
 assert.equal(snapshot.mode,'test');assert.equal(snapshot.templates[0].instructions,template.instructions);
 assert.ok(!snapshot.scheduled_at);assert.throws(()=>validateTest({...template,brief:'x'.repeat(2001)}));
});
test('production prompts preserve slot order and keep common factual rules',()=>{
 const snapshot={mode:'production',templates:[template,{...template,name:'学び',instructions:'選び方を一つ伝える'},{...template,name:'紹介',instructions:'確認済みの場所を案内'}]};
 const prompt=generationPrompt({facts:'確認済みの校舎名'},snapshot);
 assert.ok(prompt.indexOf('共感を生む投稿')<prompt.indexOf('2. 学び'));assert.ok(prompt.indexOf('2. 学び')<prompt.indexOf('3. 紹介'));
 assert.ok(prompt.includes('確認済みの校舎名'));assert.ok(prompt.includes('架空の体験談'));assert.ok(prompt.includes('JSONだけ'));
});
test('test uses unsaved instructions and production Make contract remains unchanged',async()=>{
 const token='a'.repeat(48),snapshot=validateTest({...template,instructions:'未保存の独自指示',brief:'試したい切り口'});
 const r=await generationAutomation(new Request('https://example.com/api/generation/claim',{method:'POST',headers:{Authorization:'Bearer '+token}}),{MAKE_AI_TOKEN:token},'/api/generation/claim',async()=>[{id:'job',claim_id:'claim',settings_snapshot:{facts:'公式情報'},prompt_snapshot:snapshot,kind:'test'}]);
 const body=await r.json();assert.deepEqual(Object.keys(body.job).sort(),['claim_id','id','prompt']);
 assert.ok(body.job.prompt.includes('未保存の独自指示'));assert.ok(body.job.prompt.includes('試したい切り口'));assert.ok(body.job.prompt.includes('公開しないテスト'));
});
test('editors can test but cannot save templates or change production plan',async t=>{
 const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret',MAKE_AI_TOKEN:'a'.repeat(48),OPENAI_API_KEY:'server-only'};let request;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:'editor'});
  if(url.includes('/members?'))return Response.json([{user_id:'editor',role:'editor'}]);
  assert.ok(url.endsWith('/rpc/begin_immediate_prompt_test'));request=JSON.parse(options.body);return Response.json({id:'test-job',kind:'test',status:'completed',claim_id:'old-claim',preview_posts:[{topic:'比較',body:'結果'}]});
 });
 const call=path=>worker.fetch(new Request('https://example.com/api/'+path,{method:'POST',headers:{Origin:'https://example.com',Authorization:'Bearer staff'},body:JSON.stringify({...template,request_id:'11111111-1111-4111-8111-111111111111'})}),env);
 assert.equal((await call('prompts')).status,403);assert.equal((await call('prompts/plan')).status,403);
 assert.equal((await call('prompts/test')).status,200);assert.equal(request.p_snapshot.mode,'test');assert.ok(!request.p_snapshot.target_date);
});
