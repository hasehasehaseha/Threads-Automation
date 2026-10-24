import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGenerationDate,generationPrompt} from '../src/generation.js';
import worker from '../src/worker.js';

test('generation dates reject impossible dates and use the Japanese day boundary',()=>{
 const now=new Date('2026-10-25T15:00:00Z'); // Oct 26 JST
 assert.equal(validateGenerationDate('2026-10-30',now),'2026-10-30');
 assert.equal(validateGenerationDate('2026-10-26',now),'2026-10-26');
 for(const date of ['2026-10-25','2027-02-29','2026-02-30','2026-13-01','0000-01-01','2026-1-30',null])assert.throws(()=>validateGenerationDate(date,now));
 assert.equal(validateGenerationDate('2028-02-29',now),'2028-02-29');
 assert.ok(generationPrompt({}, {target_date:'2026-10-30'}).includes('投稿予定日（日本時間）：2026-10-30'));
});

test('date requests reach the dated RPC; tomorrow remains compatible; invalid dates never enqueue',async t=>{
 const calls=[],env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret',MAKE_AI_TOKEN:'a'.repeat(48)};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:'staff'});
  if(url.includes('/members?'))return Response.json([{user_id:'staff',role:'editor'}]);
  calls.push({url,body:JSON.parse(options.body)});return Response.json({id:'job',status:'queued'});
 });
 const send=data=>worker.fetch(new Request('https://example.com/api/generate',{method:'POST',headers:{Origin:'https://example.com',Authorization:'Bearer staff'},body:JSON.stringify(data)}),env);
 assert.equal((await send({target_date:'2099-10-30'})).status,200);
 assert.ok(calls[0].url.endsWith('/rpc/request_generation_for_date'));
 assert.deepEqual(calls[0].body,{p_actor:'staff',p_target:'2099-10-30'});
 assert.equal((await send({})).status,200);assert.ok(calls[1].url.endsWith('/rpc/request_generation_job'));
 assert.equal((await send({target_date:'2099-02-30'})).status,400);assert.equal(calls.length,2);
});
