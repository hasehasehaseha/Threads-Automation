import test from 'node:test';import assert from 'node:assert/strict';
import {buildHistoryInput,historyPrompt,duplicateMatches,textSimilarity,usageCost,generateWithHistory,runProduction,memoryMemo} from '../src/ai-generation.js';
test('history memos never split emoji surrogates when saved to PostgreSQL JSONB',()=>{
 const text='あ'.repeat(24)+'😊'+'い'.repeat(84)+'🌸'+'う'.repeat(28)+'🎉';
 for(const value of Object.values(memoryMemo(text))){assert.ok(value.isWellFormed());assert.ok(JSON.stringify(value).isWellFormed());}
 assert.equal([...memoryMemo(text).opening].length,25);
 assert.ok(memoryMemo(text).opening.endsWith('😊'));
});
import {generationAutomation} from '../src/generation.js';
const job={id:'11111111-1111-4111-8111-111111111111',claim_id:'claim',kind:'production',target_date:'2026-10-25',settings_snapshot:{facts:'確認済みの校舎名'},prompt_snapshot:{count:2,templates:[{name:'共感',instructions:'気持ちに寄り添う'},{name:'学び',instructions:'選ぶ視点'}],times:['08:00','20:00']}};
const env={OPENAI_API_KEY:'private-fixture',AI_HISTORY_ENABLED:'true',MAKE_AI_TOKEN:'a'.repeat(40)};
const vec=i=>Array.from({length:256},(_,k)=>k===i?1:0);
const draft=[{topic:'共感',body:'初めての場所で緊張する気持ちに、まず耳を傾けてみませんか。',memo:{point:'緊張への共感'}},{topic:'学び',body:'習い事を選ぶときは、通い続けられる距離も確認しましょう。'}];
function harness(t,{history=[],responses=[draft],failUsage=false,denyRetry=false,failReport=false}={}){
 let generated=0,completed=0;const requests=[],writes=[],reservations=[];
 const db=async(e,p,m,b)=>{
  if(p==='ai_config?id=eq.1')return [{model:'gpt-6.1-sol'}];
  if(p==='rpc/ai_month_usage')return {productionUsd:0};
  if(p==='rpc/history_for_generation')return structuredClone(history);
  if(p.startsWith('post_memory?'))return m==='POST'?[b]:[];
  if(p==='rpc/reserve_ai_call'){reservations.push(b);if(denyRetry&&b.p_purpose==='retry')throw new Error('budget');return true;}
  if(p.startsWith('ai_usage?')){if(failUsage)throw new Error('db down');writes.push(b);return [];}
  if(p.startsWith('generation_jobs?')){if(failReport&&b.ai_report)throw new Error('report storage down');writes.push(b);return [];}
  if(p==='rpc/complete_generation_job'){completed++;return {...job,status:'completed',post_ids:['id1','id2'],preview_posts:b.p_posts};}
  if(p==='rpc/claim_history_generation_job')return [job];
  throw new Error(p);
 };
 const seen=new Map();
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  const b=JSON.parse(opts.body);requests.push({url,...b});assert.equal(opts.headers.Authorization,'Bearer private-fixture');
  if(url.endsWith('/embeddings'))return Response.json({data:b.input.map((s,index)=>{if(!seen.has(s))seen.set(s,seen.size);return {index,embedding:vec(seen.get(s))};}),usage:{prompt_tokens:100,total_tokens:100}});
  assert.equal(b.model,'gpt-6.1-sol');assert.deepEqual(b.reasoning,{effort:'low'});assert.equal(b.service_tier,'default');assert.equal(b.store,false);
  const posts=responses[Math.min(generated++,responses.length-1)];
  return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:250,cached_tokens:0},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({posts})}]}]});
 });
 return {db,requests,writes,reservations,get generated(){return generated;},get completed(){return completed;}};
}
test('history distinguishes recent full texts, older memos, and dates outside the window',()=>{
 const p=historyPrompt([{day:'2026-10-24',body:'最近の本文',topic:'共感'},{day:'2026-09-10',body:'古い本文',topic:'学び',memo:{point:'古い要点'}},{day:'2026-08-01',body:'対象外の本文'}],'2026-10-25');
 assert.ok(p.includes('最近の本文'));assert.ok(p.includes('古い要点'));assert.ok(!p.includes('古い本文'));assert.ok(!p.includes('対象外の本文'));
});
test('input bound trims history before API use and reduces only production after $15',()=>{
 const history=Array.from({length:420},(_,i)=>({id:String(i),day:'2026-10-24',topic:'話題',body:'長い履歴'.repeat(100)}));
 const r=buildHistoryInput(job,history);assert.ok(r.inputBound<=150000);assert.ok(r.includedCount<420);assert.equal(r.historyCount,420);
 assert.equal(buildHistoryInput(job,history,{productionUsd:15}).reduced,true);
 assert.equal(buildHistoryInput({...job,kind:'test'},history,{productionUsd:20}).reduced,false);
});
test('exact or semantic duplicates are flagged, matching broad themes alone is not',()=>{
 const h=[{id:'old',body:draft[0].body,day:'2026-10-24',vector:vec(1)}];
 assert.equal(duplicateMatches([draft[0]],[vec(2)],h,'2026-10-25').length,1);
 assert.equal(duplicateMatches([draft[1]],[vec(1)],h,'2026-10-25').length,1);
 assert.equal(duplicateMatches([draft[1]],[vec(2)],h,'2026-10-25').length,0);
 assert.equal(textSimilarity('同じ本文です。','同じ本文です！'),1);
});
test('production generates all slots once, meters reasoning-inclusive usage, caches memory, and saves only drafts',async t=>{
 const h=harness(t);const r=await generateWithHistory(env,h.db,job);
 assert.equal(h.generated,1);assert.equal(h.completed,1);assert.equal(r.ai_report.model,'gpt-6.1-sol');
 assert.equal(h.requests.filter(r=>r.url.endsWith('/responses')).length,1);
 assert.ok(h.writes.some(w=>w.output_tokens===250&&w.cost_usd===.005));
 assert.ok(h.reservations.every(r=>r.p_reserve>0));assert.ok(!h.requests.some(r=>/threads|make/.test(r.url)));
});
test('similarity retries only affected slot once; unresolved duplicate never becomes a real draft',async t=>{
 const history=[{id:'existing',day:'2026-10-24',body:draft[0].body,topic:'共感'}];
 const h=harness(t,{history,responses:[draft,[draft[0]]]});const r=await generateWithHistory(env,h.db,job);
 assert.equal(h.generated,2);assert.equal(h.completed,0);assert.equal(r.status,'needs_review');assert.equal(r.preview_posts.length,2);
 const retries=h.requests.filter(r=>r.url.endsWith('/responses'));assert.ok(retries[1].input.includes('下書きを1件'));
});
test('budget refusal during retry preserves the first paid result for review',async t=>{
 const h=harness(t,{history:[{id:'existing',day:'2026-10-24',body:draft[0].body}],denyRetry:true});
 const r=await generateWithHistory(env,h.db,job);assert.equal(h.generated,1);assert.equal(h.completed,0);assert.equal(r.preview_posts.length,2);
});
test('usage write failure is not retried; unknown reservation remains conservative',async t=>{
 const h=harness(t,{failUsage:true});const r=await generateWithHistory(env,h.db,job);assert.equal(h.generated,1);assert.equal(r.status,'completed');
});
test('diagnostic report write failure does not erase a paid result or repeat generation',async t=>{
 const h=harness(t,{failReport:true});const r=await generateWithHistory(env,h.db,job);assert.equal(h.generated,1);assert.equal(h.completed,1);assert.equal(r.preview_posts.length,2);
});
test('Make orchestration returns job:null so legacy OpenAI and result modules cannot execute',async t=>{
 const h=harness(t);const r=await generationAutomation(new Request('https://local/api/generation/claim',{method:'POST',headers:{Authorization:'Bearer '+env.MAKE_AI_TOKEN}}),env,'/api/generation/claim',h.db);
 assert.deepEqual(await r.json(),{job:null,processed:true,id:job.id,status:'completed'});assert.equal(h.generated,1);
});
test('empty queue never calls OpenAI, and unknown usage is not treated as zero',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('must not call');});
 assert.deepEqual(await runProduction(env,async()=>[]),{job:null,processed:false});assert.equal(usageCost('gpt-6.1-sol',null),null);
});
