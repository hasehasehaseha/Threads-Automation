import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/worker.js';import {runWeeklyGeneration} from '../src/weekly-generation.js';
const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',AI_HISTORY_ENABLED:'true',OPENAI_API_KEY:'private-openai'};
const id='11111111-1111-4111-8111-111111111111',slots=Array.from({length:7},(_,i)=>({prompt_id:id,time:String(10+i).padStart(2,'0')+':00'}));
test('weekly API queues one atomic request for 1, 3 or 7 daily slots, never calls OpenAI while enqueueing',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'editor'});
  if(url.includes('/members?'))return Response.json([{user_id:'editor',role:'editor'}]);
  assert.ok(url.endsWith('/rpc/request_weekly_generation'));const body=JSON.parse(opts.body);calls.push(body);
  return Response.json({id:body.p_id,new_job_ids:[],job_ids:Array(7).fill(id)});
 });
 const send=(body,origin='https://studio.example')=>worker.fetch(new Request('https://studio.example/api/generate-week',{method:'POST',headers:{Origin:origin,Authorization:'Bearer staff'},body:JSON.stringify(body)}),env);
 for(const n of [1,3,7]){const r=await send({request_id:id,start_date:'2099-10-30',slots:slots.slice(0,n)});assert.equal(r.status,200);assert.equal(calls.at(-1).p_times.length,n);assert.equal(calls.at(-1).p_start,'2099-10-30');}
 assert.equal((await send({request_id:'bad',start_date:'2099-10-30',slots})).status,400);
 assert.equal((await send({request_id:id,start_date:'2099-02-30',slots})).status,400);
 assert.equal((await send({request_id:id,start_date:'2099-10-30',slots:[slots[0],slots[0]]})).status,400);
 assert.equal((await send({request_id:id,start_date:'2099-10-30',slots},'https://evil.example')).status,403);assert.equal(calls.length,3);
});
test('weekly minute trigger processes at most one day and leaves serialization to the shared claim',async()=>{
 let pending=false,processed=0,queries=0;
 const db=async(e,p)=>{queries++;assert.equal(p,'generation_jobs?kind=eq.production&status=eq.queued&select=id&limit=1');return pending?[{id}]:[];};
 const runner=async()=>{processed++;return {processed:true};};
 assert.deepEqual(await runWeeklyGeneration({},()=>{throw new Error('must not query');},runner),{processed:false});
 await runWeeklyGeneration(env,db,runner);assert.equal(processed,0);
 pending=true;await runWeeklyGeneration(env,db,runner);assert.equal(processed,1);assert.equal(queries,2);
 // A later invocation is a separate day, not one 49-output API call.
 await runWeeklyGeneration(env,db,runner);assert.equal(processed,2);
});
test('generation failure cannot prevent the separately registered publishing cron task',async t=>{
 const tasks=[];
 t.mock.method(globalThis,'fetch',async(url)=>{
  if(url.includes('/generation_jobs?kind=eq.production'))throw new Error('generation database unavailable');
  return Response.json([]);
 });
 await worker.scheduled({cron:'* * * * *'},{...env,AUTOMATION_ENABLED:'false'}, {waitUntil:p=>tasks.push(p)});
 const result=await Promise.allSettled(tasks);assert.equal(tasks.length,2);assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'fulfilled');
});
