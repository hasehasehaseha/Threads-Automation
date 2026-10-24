// Each external write is attempted once. Uncertain outcomes require reconciliation.
export function immediateReady(env){return env.IMMEDIATE_ENABLED==='true'&&!!env.THREADS_ACCESS_TOKEN;}
async function meta(env,path,body){
 const response=await fetch('https://graph.threads.net/v1.0/'+path,{
  method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{Authorization:'Bearer '+env.THREADS_ACCESS_TOKEN,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
  body:body?new URLSearchParams(body):undefined
 });
 if(!response.ok){
  const data=await response.json().catch(()=>({}));
  const code=Number.isInteger(data.error?.code)?data.error.code:'unknown';
  const subcode=Number.isInteger(data.error?.error_subcode)?data.error.error_subcode:'none';
  throw new Error(`Meta HTTP ${response.status} / code ${code} / subcode ${subcode}`);
 }
 return response.json();
}
export async function checkThreadsConnection(env){
 const user=await meta(env,'me?fields=id,username');
 if(user.username!=='neis_hiroshima')throw new Error('Threadsの接続先アカウントが一致しません');
 return user;
}
export async function publishClaim(env,post,db){
 try{
  const container=await meta(env,'40462225730042818/threads',{media_type:'TEXT',text:post.body});
  if(!/^\d{1,100}$/.test(container.id))throw new Error('Invalid container');
  const status=await meta(env,container.id+'?fields=status,error_message');
  if(status.status!=='FINISHED')throw new Error('Container not ready');
  const published=await meta(env,'40462225730042818/threads_publish',{creation_id:container.id});
  if(!/^\d{1,100}$/.test(published.id))throw new Error('Invalid published id');
  await db(env,'rpc/complete_claim','POST',{p_id:post.id,p_claim:post.claim_id,p_status:'published',p_meta_id:published.id});
  return {id:post.id,status:'published',meta_post_id:published.id};
 }catch{
  // Never send a second publish request, including after a callback timeout.
  try{await db(env,'rpc/complete_claim','POST',{p_id:post.id,p_claim:post.claim_id,p_status:'needs_review',p_meta_id:null});}catch{}
  throw new Error('公開結果を確定できません。再投稿せず、Threadsの投稿と管理画面を照合してください。');
 }
}
