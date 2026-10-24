import test from 'node:test';import assert from 'node:assert/strict';
import {publishDue,runScheduled} from '../src/scheduler.js';
const env={AUTOMATION_ENABLED:'true',THREADS_ACCESS_TOKEN:'secret'};
test('disabled scheduling does not claim any posts',async()=>{
 const db=()=>{throw new Error('must not claim');};
 assert.deepEqual(await publishDue({...env,AUTOMATION_ENABLED:'false'},db),{published:0,failed:0});
 assert.deepEqual(await publishDue({AUTOMATION_ENABLED:'true'},db),{published:0,failed:0});
});
test('each claimed post is attempted once, uncertain results are never retried',async()=>{
 const queue=[{id:'a'},{id:'b'}],attempts=[];let claims=0;
 const db=async(e,path,method)=>{assert.equal(path,'rpc/claim_due_post');assert.equal(method,'POST');claims++;return queue.length?[queue.shift()]:[];};
 const result=await publishDue(env,db,async(e,p)=>{attempts.push(p.id);if(p.id==='a')throw new Error('uncertain');});
 assert.deepEqual(result,{published:1,failed:1});assert.deepEqual(attempts,['a','b']);assert.equal(claims,3);
});
test('cron processing is bounded and metrics are not fetched every minute',async()=>{
 let writes=0,metrics=0;
 await publishDue(env,async()=>[{id:'x'}],async()=>{writes++;});assert.equal(writes,3);
 const handlers={publishDue:async()=>{writes++;},collectMetrics:async()=>{metrics++;}};
 await runScheduled({cron:'* * * * *'},env,null,handlers);assert.equal(writes,4);assert.equal(metrics,0);
 await runScheduled({cron:'30 12 * * *'},env,null,handlers);assert.equal(writes,4);assert.equal(metrics,1);
 await runScheduled({cron:'unknown'},env,null,handlers);assert.equal(metrics,1);
});
