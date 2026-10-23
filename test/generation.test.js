import test from 'node:test';
import assert from 'node:assert/strict';
import {generationPrompt,parseGeneratedPosts,generationAutomation} from '../src/generation.js';
const posts=[{topic:'A',body:'本文A'},{topic:'B',body:'本文B'},{topic:'C',body:'本文C'}];
test('AI output validates all drafts before persisting',()=>{
 assert.deepEqual(parseGeneratedPosts(JSON.stringify({posts})),posts);
 for(const value of [{posts:posts.slice(0,2)},{posts:[posts[0],posts[0],posts[2]]},{posts:[{topic:'A',body:'a'.repeat(501)},posts[1],posts[2]]}])assert.throws(()=>parseGeneratedPosts(JSON.stringify(value)));
 assert.throws(()=>parseGeneratedPosts('```json\n{}\n```'));
});
test('saved policy is included without inventing school facts',()=>{
 const p=generationPrompt({theme:'親子',rules:'料金を書かない'});
 assert.ok(p.includes('親子'));assert.ok(p.includes('料金を書かない'));assert.ok(p.includes('雰囲気'));assert.ok(p.includes('公開や予約の承認は行いません'));
});
test('AI key is isolated from publishing key',async()=>{
 let called=false;
 const req=new Request('https://app.example/api/generation/claim',{method:'POST',headers:{Authorization:'Bearer '+ 'p'.repeat(48)}});
 const r=await generationAutomation(req,{MAKE_AI_TOKEN:'a'.repeat(48)},'/api/generation/claim',()=>{called=true;});
 assert.equal(r.status,401);assert.equal(called,false);
});
test('AI claim exposes only job ids and prompt',async()=>{
 const req=new Request('https://app.example/api/generation/claim',{method:'POST',headers:{Authorization:'Bearer '+ 'a'.repeat(48)}});
 const r=await generationAutomation(req,{MAKE_AI_TOKEN:'a'.repeat(48)},'/api/generation/claim',async()=>[{id:'job',claim_id:'claim',settings_snapshot:{theme:'教室'},created_by:'private'}]);
 const result=await r.json();assert.deepEqual(Object.keys(result.job).sort(),['claim_id','id','prompt']);
});
