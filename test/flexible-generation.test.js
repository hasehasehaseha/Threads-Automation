import test from 'node:test';import assert from 'node:assert/strict';
import {validateGenerationSlots,generationPrompt,parseGeneratedPosts} from '../src/generation.js';
import worker from '../src/worker.js';
const id='11111111-1111-4111-8111-111111111111';
const slots=Array.from({length:7},(_,i)=>({prompt_id:id,time:String(10+i).padStart(2,'0')+':15'}));
test('slots support 1-7 with unique valid times and future times for today',()=>{
 const now=new Date('2026-10-25T00:00:00Z');
 for(const n of [1,3,5,7])assert.equal(validateGenerationSlots(slots.slice(0,n),'2026-10-25',now).length,n);
 for(const bad of [[],[...slots,slots[0]],[slots[0],slots[0]],[{prompt_id:id,time:'24:00'}],[{prompt_id:'bad',time:'12:00'}]])assert.throws(()=>validateGenerationSlots(bad));
 assert.throws(()=>validateGenerationSlots([{prompt_id:id,time:'08:59'}],'2026-10-25',now));
});
test('exact output count is prompted and validated while tests remain three variants',()=>{
 for(const count of [1,5,7]){
  const prompt=generationPrompt({}, {mode:'production',count,templates:Array.from({length:count},(_,i)=>({name:'P'+i,category:'学び',instructions:'指示'+i}))});
  assert.ok(prompt.includes('下書きを'+count+'件'));assert.ok(prompt.includes('posts配列は必ず'+count+'件'));
  const output=JSON.stringify({posts:Array.from({length:count},(_,i)=>({topic:'案'+i,body:'本文'+i}))});
  assert.equal(parseGeneratedPosts(output,count).length,count);assert.throws(()=>parseGeneratedPosts(output,count===1?3:1));
 }
 assert.ok(generationPrompt({}, {mode:'test',count:7}).includes('下書きを3件'));
 assert.throws(()=>parseGeneratedPosts(JSON.stringify({posts:Array.from({length:8},(_,i)=>({topic:'案'+i,body:'本文'+i}))}),null));
});
test('configured API preserves slot order, today validation, and admin-only defaults',async t=>{
 const calls=[],env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret',MAKE_AI_TOKEN:'a'.repeat(48)};
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:'editor'});
  if(url.includes('/members?'))return Response.json([{user_id:'editor',role:'editor'}]);
  calls.push({url,body:JSON.parse(opts.body)});return Response.json({id:'job'});
 });
 const send=(path,data)=>worker.fetch(new Request('https://example.com/api/'+path,{method:'POST',headers:{Origin:'https://example.com',Authorization:'Bearer staff'},body:JSON.stringify(data)}),env);
 assert.equal((await send('generate',{target_date:'2099-10-30',slots:slots.slice(0,5)})).status,200);
 assert.ok(calls[0].url.endsWith('/request_configured_generation'));assert.deepEqual(calls[0].body.p_times,slots.slice(0,5).map(s=>s.time));
 assert.equal((await send('generation-plan',{slots})).status,403);
 assert.equal((await send('generate',{target_date:'2099-10-30',slots:[slots[0],slots[0]]})).status,400);assert.equal(calls.length,1);
});
