import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledDateContext,generationPrompt,generationAutomation} from '../src/generation.js';
import {buildHistoryInput} from '../src/ai-generation.js';
const snapshot={mode:'production',count:2,times:['00:05','20:00'],templates:[{name:'任意',instructions:'保存した指示を維持'}]};
test('each slot receives the intended JST date, weekday and ISO timestamp at year boundary',()=>{
 const result=scheduledDateContext({...snapshot,target_date:'2027-01-01'});
 assert.ok(result.includes('金曜日'));assert.ok(result.includes('"month": 1'));
 assert.ok(result.includes('2027-01-01T00:05:00+09:00'));assert.ok(result.includes('2027-01-01T20:00:00+09:00'));
 assert.ok(result.includes('Asia/Tokyo'));assert.ok(result.includes('"post_number": 2'));
 for(const date of ['2026-02-30','not-a-date',undefined])assert.equal(scheduledDateContext({...snapshot,target_date:date}),'');
 assert.equal(scheduledDateContext({...snapshot,mode:'test',target_date:'2027-01-01'}),'');
});
test('history generation uses job date over stale snapshot for daily, weekly and remapped retry slots',()=>{
 for(const date of ['2026-11-01','2026-11-02']){
  const prompt=buildHistoryInput({kind:'production',target_date:date,settings_snapshot:{},prompt_snapshot:{...snapshot,target_date:'2020-01-01'}},[]).prompt;
  assert.ok(prompt.includes(date+'T20:00:00+09:00'));assert.ok(!prompt.includes('2020-01-01'));
  assert.ok(prompt.includes('保存した指示を維持'));assert.ok(!prompt.includes('自然に合う場合だけ'));
 }
 const retry=buildHistoryInput({kind:'production',target_date:'2026-11-01',settings_snapshot:{},prompt_snapshot:{...snapshot,count:1,times:['20:00']}},[]).prompt;
 assert.ok(retry.includes('"post_number": 1'));assert.ok(!retry.includes('T00:05:00'));
 assert.ok(!generationPrompt({}, {...snapshot,mode:'test',count:1}).includes('システム提供の投稿予定日時'));
});
test('legacy Make generation also includes job date without modifying stored templates',async()=>{
 const original=JSON.stringify(snapshot),key='k'.repeat(40);
 const result=await generationAutomation(new Request('https://app.example/api/generation/claim',{method:'POST',headers:{Authorization:'Bearer '+key}}),{MAKE_AI_TOKEN:key},'/api/generation/claim',async()=>[{id:'job',claim_id:'claim',target_date:'2026-11-01',settings_snapshot:{},prompt_snapshot:snapshot}]);
 assert.ok((await result.json()).job.prompt.includes('2026-11-01T20:00:00+09:00'));
 assert.equal(JSON.stringify(snapshot),original);
});
