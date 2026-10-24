import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/worker.js';import {generationPrompt} from '../src/generation.js';
const id='11111111-1111-4111-8111-111111111111';
test('normal prompts have variable count and numbered time/prompt mapping without fixed-three instructions',()=>{
 for(const count of [1,5,7]){
  const times=Array.from({length:count},(_,i)=>String(10+i)+':15');
  const templates=times.map((_,i)=>({name:'個別'+i,category:'分類',instructions:'指示'+i}));
  const p=generationPrompt({facts:'公式の校舎名'},{mode:'production',count,times,templates,target_date:'2099-10-30'});
  assert.ok(p.includes('下書きを'+count+'件'));assert.ok(!p.includes('3件'));assert.ok(!p.includes('3案'));
  assert.ok(p.includes('投稿時刻 '+times.at(-1)+' JST'));assert.ok(p.includes('今回の依頼の件数・番号・出力形式を優先'));
  assert.ok(p.includes('架空の体験談'));assert.ok(p.includes('評判'));
 }
});
test('normal preview uses current selections and authoritative saved instructions without creating a job',async t=>{
 const calls=[],times=['09:10','11:20','14:30','17:40','20:50'];
 const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret'};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push(url);
  if(url.includes('/auth/v1/user'))return Response.json({id:'staff'});
  if(url.includes('/members?'))return Response.json([{user_id:'staff',role:'editor'}]);
  if(url.includes('/editorial_settings?'))return Response.json([{content:{facts:'確認済み情報'}}]);
  assert.ok(url.endsWith('/rpc/generation_snapshot'));
  const req=JSON.parse(options.body);assert.deepEqual(req.p_times,times);assert.deepEqual(req.p_slots,Array(5).fill(id));
  return Response.json({mode:'production',count:5,times,templates:times.map((_,i)=>({id,name:'保存済み'+i,category:'テーマ',instructions:'保存済みの指示'+i}))});
 });
 const res=await worker.fetch(new Request('https://example.com/api/prompts/production-preview',{method:'POST',headers:{Origin:'https://example.com',Authorization:'Bearer staff'},body:JSON.stringify({target_date:'2099-10-30',slots:times.map(time=>({time,prompt_id:id})),instructions:'偽の未保存入力'})}),env);
 assert.equal(res.status,200);const result=await res.json();
 assert.equal(result.count,5);assert.ok(result.prompt.includes('保存済みの指示4'));assert.ok(!result.prompt.includes('偽の未保存入力'));assert.ok(!result.prompt.includes('3件'));
 assert.ok(!calls.some(url=>url.includes('request_')||url.includes('generation_jobs')));
});
