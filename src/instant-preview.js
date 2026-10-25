import {generationPrompt,parseGeneratedPosts,uuid} from './generation.js';
import {validateTest} from './prompts.js';

export function publicTestResult(job){
 const result={};for(const key of ['id','kind','status','created_at','completed_at','prompt_snapshot','preview_posts','test_error','historySaved'])if(job[key]!==undefined)result[key]=job[key];
 return result;
}

export async function runImmediateTest(env,actor,data,db){
 if(!env.OPENAI_API_KEY)throw new Error('即時テスト用のOpenAI接続を設定してください。');
 if(!uuid.test(data.request_id))throw new Error('テスト依頼IDが不正です。');
 const claim=crypto.randomUUID(),snapshot=validateTest(data);
 const job=await db(env,'rpc/begin_immediate_prompt_test','POST',{p_actor:actor,p_snapshot:snapshot,p_id:data.request_id,p_claim:claim});
 if(job.claim_id!==claim)return job; // Replayed requests never trigger another paid call.
 if(env.AI_HISTORY_ENABLED==='true'){
  try{const {generateWithHistory}=await import('./ai-generation.js');return await generateWithHistory(env,db,job);}
  catch{const message='AIテストを完了できませんでした。OpenAI接続と生成履歴を確認してください。自動再実行はしません。';
   await db(env,'generation_jobs?id=eq.'+job.id+'&claim_id=eq.'+claim+'&status=eq.generating','PATCH',{status:'needs_review',test_error:message}).catch(()=>{});
   return {...job,status:'needs_review',test_error:message};
  }
 }
 let posts;
 try{
  const r=await fetch('https://api.openai.com/v1/responses',{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(45000),
   headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({model:'gpt-4.1-mini',input:generationPrompt(job.settings_snapshot,job.prompt_snapshot),max_output_tokens:1800,store:false,text:{format:{type:'json_object'}}})
  });
  if(!r.ok)throw new Error(r.status===429?'AIの利用上限に達しました。時間をおいてお試しください。':r.status===401?'OpenAI接続の認証を確認してください。':'AI生成に失敗しました。接続設定を確認してください。');
  const response=await r.json();
  if(response.status!=='completed')throw new Error('AIの出力が完了しませんでした。指示を短くしてお試しください。');
  const output=(response.output||[]).filter(m=>m.type==='message').flatMap(m=>m.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  try{posts=parseGeneratedPosts(output,1);}catch{throw new Error('AIの出力形式または文字数が不正でした。指示を確認してください。');}
 }catch(error){
  const message=error.name==='TimeoutError'?'AIからの応答が時間内に届きませんでした。':error instanceof TypeError?'AIへ接続できませんでした。':error.message;
  const safeMessage=message?.startsWith('AI')||message?.startsWith('OpenAI')?message:'テスト生成に失敗しました。';
  const failed={...job,status:'needs_review',test_error:safeMessage};
  try{await db(env,'generation_jobs?id=eq.'+job.id+'&claim_id=eq.'+claim+'&status=eq.generating','PATCH',{status:'needs_review',test_error:safeMessage});}catch{}
  return failed;
 }
 try{return await db(env,'rpc/complete_generation_job','POST',{p_id:job.id,p_claim:claim,p_posts:posts});}
 catch{
  // Keep the generated text visible even when the history write fails; never retry OpenAI automatically.
  return {...job,status:'needs_review',preview_posts:posts,historySaved:false,test_error:'文章は生成できましたが、履歴を保存できませんでした。この画面から文章をコピーしてください。'};
 }
}
