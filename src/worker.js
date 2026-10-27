import {generationAutomation,validateGenerationDate,validateGenerationSlots} from './generation.js';
import {immediateReady,publishClaim,checkThreadsConnection} from './publish.js';
import {collectMetrics} from './metrics.js';
import {runScheduled,publishDue} from './scheduler.js';
import {threadsEnvironment,tokenStatus,initializeToken,refreshThreadsToken} from './threads-token.js';
import {validateTemplate,validateTest} from './prompts.js';
import {runImmediateTest,publicTestResult} from './instant-preview.js';
import {runWeeklyGeneration} from './weekly-generation.js';
import {validateApprovalPreview,validateBulkApproval} from './bulk-approval.js';
import {notificationEmail,notificationSettings} from './approval-notifications.js';
import {sessionCookies,staffSession} from './staff-session.js';
import {validateBulkTrash} from './bulk-trash.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function validatePost(data){
 if(typeof data.body!=='string'||!data.body.trim()||[...data.body].length>500)throw new Error('投稿文は1〜500文字で入力してください');
 if(data.planned&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.planned))throw new Error('投稿日時が不正です');
 const at=data.planned?new Date(data.planned+':00+09:00'):null;
 if(at&&Number.isNaN(at.valueOf()))throw new Error('投稿日時が不正です');
 return {p_body:data.body.trim(),p_topic:String(data.topic||'').slice(0,100),p_at:at?.toISOString()||null,p_settings:data.settings_id||null};
}
export function isReady(env){return !!(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY&&env.SUPABASE_SERVICE_ROLE_KEY);}
async function db(env,path,method='GET',body){
const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'+(path.startsWith('post_memory?')&&method==='POST'?',resolution=merge-duplicates':'')},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw new Error('保存できませんでした。権限、日時の重複、他の人による変更を確認して再読み込みしてください。');
 return r.status===204?null:r.json();
}
async function member(req,env){
 const token=req.headers.get('Authorization')||('Bearer '+(sessionCookies(req).access||''));if(!token.startsWith('Bearer ')||!token.slice(7))return null;
 const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:token}});
 if(!r.ok)return null;const user=await r.json();
 const rows=await db(env,'members?user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true&select=user_id,role');
 return rows[0]||null;
}
async function automation(req,env,path){
 if(!env.MAKE_API_TOKEN||env.MAKE_API_TOKEN.length<32)return json({error:'自動化接続は未設定です'},503);
 if(req.headers.get('Authorization')!=='Bearer '+env.MAKE_API_TOKEN)return json({error:'認証が必要です'},401);
 if(req.method!=='POST')return json({error:'POSTのみ対応しています'},405);
 if(path==='/api/automation/check')return json({connected:true,publishingEnabled:env.AUTOMATION_ENABLED==='true'});
 if(path==='/api/automation/claim'&&env.AUTOMATION_ENABLED!=='true')return json({error:'自動投稿は停止中です'},409);
 try{
 if(path==='/api/automation/notification-claim'){
  const n=await db(env,'rpc/claim_approval_notification','POST',{});return json({notification:n?notificationEmail(n):null});
 }
 if(path==='/api/automation/notification-result'){
  const raw=await req.text();if(raw.length>1000)return json({error:'入力が大きすぎます'},413);const d=JSON.parse(raw),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(d.id)||!uuid.test(d.claim_id)||typeof d.message_id!=='string'||!d.message_id||d.message_id.length>200)return json({error:'結果形式が不正です'},400);
  return json({saved:await db(env,'rpc/complete_approval_notification','POST',{p_id:d.id,p_claim:d.claim_id,p_message:d.message_id})});
 }
 if(path==='/api/automation/claim'){
 const rows=await db(env,'rpc/claim_due_post','POST',{});
 const p=rows[0];return json({post:p?{id:p.id,claim_id:p.claim_id,body:p.body,scheduled_at:p.scheduled_at}:null});
 }
 if(path==='/api/automation/result'){
 const raw=await req.text();if(raw.length>4000)return json({error:'入力が大きすぎます'},413);
 const d=JSON.parse(raw),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(d.id)||!uuid.test(d.claim_id)||!['published','needs_review'].includes(d.status))return json({error:'結果形式が不正です'},400);
 if(d.status==='published'&&(typeof d.meta_post_id!=='string'||!/^\d{1,100}$/.test(d.meta_post_id)))return json({error:'Meta投稿IDが必要です'},400);
 return json(await db(env,'rpc/complete_claim','POST',{p_id:d.id,p_claim:d.claim_id,p_status:d.status,p_meta_id:d.status==='published'?d.meta_post_id:null}));
 }
 return json({error:'見つかりません'},404);
 }catch{return json({error:'自動処理の結果を確定できません。再投稿せず管理者が確認してください。'},400);}
}
export default {async scheduled(event,env,ctx){
 if(event.cron==='* * * * *')ctx.waitUntil(runWeeklyGeneration(env,db));
 ctx.waitUntil((async()=>{
 if(event.cron==='30 12 * * *')await refreshThreadsToken(env,db);
 const connectedEnv=await threadsEnvironment(env,db);
 return runScheduled(event,connectedEnv,db,{publishDue,collectMetrics});
})());},async fetch(req,env,ctx){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(path==='/api/config'&&req.method==='GET')return json({ready:isReady(env),supabaseUrl:env.SUPABASE_URL||'',anonKey:env.SUPABASE_ANON_KEY||'',automationEnabled:env.AUTOMATION_ENABLED==='true',handle:'neis_hiroshima'});
 if(!isReady(env))return json({error:'Supabaseの接続設定がまだ完了していません。'},503);
 if(path.startsWith('/api/generation/'))return generationAutomation(req,env,path,db,ctx);
 if(path.startsWith('/api/automation/'))return automation(req,env,path);
 if(req.method!=='GET'&&req.headers.get('Origin')!==url.origin)return json({error:'同じ管理画面から操作してください。'},403);
 if(path.startsWith('/api/auth/'))return staffSession(req,env,path,db);
 try{
 const m=await member(req,env);if(!m)return json({error:'ログインまたはスタッフ登録が必要です。'},401);
 if(path==='/api/state'&&req.method==='GET'){
 const notifications=m.role==='admin'?{settings:(await db(env,'approval_notification_settings?id=eq.1'))[0],deliveries:await db(env,'approval_notifications?select=id,target_date,slot,kind,recipient,status,created_at,claimed_at,sent_at&order=created_at.desc&limit=20'),ready:!!env.MAKE_API_TOKEN}:null;
 const [posts,settings,metrics]=await Promise.all([db(env,'posts?order=created_at.desc&limit=300'),db(env,'editorial_settings?order=id.desc&limit=1'),db(env,'metric_snapshots?order=captured_at.desc&limit=300')]);
 const generationJobs=env.MAKE_AI_TOKEN||env.OPENAI_API_KEY?await db(env,'generation_jobs?select=id,target_date,kind,status,created_at,completed_at,preview_posts,prompt_snapshot,test_error'+(env.AI_HISTORY_ENABLED==='true'?',ai_report':'')+'&order=created_at.desc&limit=30'):[];
 const [promptTemplates,promptPlans]=await Promise.all([db(env,'prompt_templates?order=created_at.asc,id.asc&limit=100'),db(env,'prompt_plan?id=eq.1')]);
 const ai=env.AI_HISTORY_ENABLED==='true'?{config:(await db(env,'ai_config?id=eq.1'))[0],usage:await db(env,'rpc/ai_month_usage','POST',{})}:null;
 const generationBatches=env.AI_HISTORY_ENABLED==='true'?await db(env,'rpc/weekly_generation_status','POST',{}):[];
 return json({member:m,posts,settings:settings[0]||null,metrics,ai,generationBatches,notifications,generationEnabled:!!env.MAKE_AI_TOKEN||(env.AI_HISTORY_ENABLED==='true'&&!!env.OPENAI_API_KEY),generationImmediateEnabled:env.AI_HISTORY_ENABLED==='true'&&!!env.OPENAI_API_KEY,testEnabled:!!env.OPENAI_API_KEY,generationJobs,promptTemplates,promptPlan:promptPlans[0]||null,immediateEnabled:immediateReady(env),automationEnabled:env.AUTOMATION_ENABLED==='true',metricsEnabled:!!env.THREADS_ACCESS_TOKEN,threadsToken:await tokenStatus(env,db)});
 }
 if(req.method!=='POST')return json({error:'見つかりません'},404);
 const raw=await req.text();if(raw.length>30000)return json({error:'入力内容が大きすぎます'},413);const data=JSON.parse(raw);
 if(path==='/api/posts/bulk-trash'){
  if(m.role!=='admin')return json({error:'一括移動は管理者のみ可能です'},403);
  const args=validateBulkTrash(data);
  try{return json(await db(env,'rpc/trash_drafts_bulk','POST',{p_actor:m.user_id,...args}));}
  catch{return json({error:'移動結果を確認できませんでした。対象の変更がある可能性もあります。最新情報とごみ箱を確認してから再操作してください。'},409);}
 }
 if(path==='/api/notifications/settings'||path==='/api/notifications/test'){
  if(m.role!=='admin')return json({error:'通知設定は管理者のみ可能です'},403);
  if(path.endsWith('settings'))return json(await db(env,'rpc/save_approval_notifications','POST',{p_actor:m.user_id,...notificationSettings(data)}));
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.request_id))return json({error:'依頼IDが不正です'},400);
  return json({id:await db(env,'rpc/request_approval_notification_test','POST',{p_actor:m.user_id,p_request:data.request_id})});
 }
 if(path==='/api/posts/trash'){
  if(m.role!=='admin')return json({error:'削除・復元は管理者のみ可能です'},403);
  if(!/^[0-9a-f-]{36}$/i.test(data.id)||!Number.isInteger(data.version)||!['trash','restore'].includes(data.action))return json({error:'投稿または操作が不正です'},400);
  try{return json(await db(env,'rpc/trash_post','POST',{p_actor:m.user_id,p_id:data.id,p_version:data.version,p_restore:data.action==='restore'}));}
  catch{return json({error:'変更できませんでした。投稿の状態が変わった可能性があります。最新情報を確認してください。'},409);}
 }
 if(path==='/api/posts/bulk-preview'||path==='/api/posts/bulk-approve'){
  if(m.role!=='admin')return json({error:'一括承認は管理者のみ可能です'},403);
  const args=path.endsWith('bulk-preview')?validateApprovalPreview(data):validateBulkApproval(data);
  try{return json(await db(env,'rpc/'+(path.endsWith('bulk-preview')?'preview_bulk_approval':'approve_bulk_posts'),'POST',{p_actor:m.user_id,...args}));}
  catch{return json({error:'処理結果を確認できませんでした。対象の変更や予約上限の可能性があります。再操作の前に最新情報と予約状況を確認してください。'},409);}
 }
 if(path==='/api/generate-week'){
  if(env.AI_HISTORY_ENABLED!=='true'||!env.OPENAI_API_KEY)return json({error:'週間生成は接続準備中です'},503);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.request_id))return json({error:'依頼IDが不正です'},400);
  const target=validateGenerationDate(data.start_date),slots=validateGenerationSlots(data.slots,target);
  return json(await db(env,'rpc/request_weekly_generation','POST',{p_actor:m.user_id,p_id:data.request_id,p_start:target,p_slots:slots.map(s=>s.prompt_id),p_times:slots.map(s=>s.time)}));
 }
 if(path==='/api/generate-start'){
  if(env.AI_HISTORY_ENABLED!=='true'||!env.OPENAI_API_KEY)return json({error:'即時生成は接続準備中です'},503);
  const {runProduction}=await import('./ai-generation.js');
  // Await while connected. The shared DB claim serializes Make, cron and clicks.
  const task=runProduction(env,db);ctx?.waitUntil(task.catch(()=>{}));
  return json(await task);
 }
 if(path==='/api/ai-config'){
  if(m.role!=='admin')return json({error:'AIモデルの変更は管理者のみ可能です'},403);
  if(!['gpt-6.1-sol','gpt-6-luna'].includes(data.model)||!Number.isInteger(data.version))return json({error:'モデル設定が不正です'},400);
  return json(await db(env,'rpc/save_ai_config','POST',{p_actor:m.user_id,p_version:data.version,p_model:data.model}));
 }
 if(path==='/api/prompts'){
 if(m.role!=='admin')return json({error:'プロンプトの保存は管理者のみ可能です'},403);
 if(data.id&&(!/^[0-9a-f-]{36}$/i.test(data.id)||!Number.isInteger(data.version)))return json({error:'プロンプトの版が不正です'},400);
 return json(await db(env,'rpc/save_prompt_template','POST',{p_actor:m.user_id,p_id:data.id||null,p_version:data.version||null,p_content:validateTemplate(data)}));
 }
 if(path==='/api/generation-plan'){
 if(m.role!=='admin')return json({error:'初期設定の保存は管理者のみ可能です'},403);
 const slots=validateGenerationSlots(data.slots);
 return json(await db(env,'rpc/save_generation_plan','POST',{p_actor:m.user_id,p_version:data.version||null,p_slots:slots.map(s=>s.prompt_id),p_times:slots.map(s=>s.time)}));
 }
 if(path==='/api/prompts/plan'){
 if(m.role!=='admin')return json({error:'使い分けの設定は管理者のみ可能です'},403);
 if(!Array.isArray(data.slots)||data.slots.length!==3||data.slots.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))return json({error:'3投稿分のプロンプトを選んでください'},400);
 return json(await db(env,'rpc/save_prompt_plan','POST',{p_actor:m.user_id,p_version:data.version||null,p_slots:data.slots}));
 }
 if(path==='/api/prompts/test'){
 if(!env.OPENAI_API_KEY)return json({error:'即時テスト用のOpenAI接続を設定してください。'},503);
 const task=runImmediateTest(env,m.user_id,data,db);ctx?.waitUntil(task.catch(()=>{}));
 return json(publicTestResult(await task));
 }
 if(path==='/api/prompts/preview'){
 const {generationPrompt}=await import('./generation.js');
 const settings=(await db(env,'editorial_settings?order=id.desc&limit=1'))[0];
 if(!settings)return json({error:'先に投稿方針を保存してください'},400);
 let prompt=generationPrompt(settings.content,validateTest(data));
 if(env.AI_HISTORY_ENABLED==='true'){const {historyContext,buildHistoryInput}=await import('./ai-generation.js');prompt=buildHistoryInput({kind:'test',settings_snapshot:settings.content,prompt_snapshot:validateTest(data)},await historyContext(env,db)).prompt;}
 return json({prompt});
 }
 if(path==='/api/prompts/production-preview'){
 const {generationPrompt}=await import('./generation.js');
 const target=validateGenerationDate(data.target_date),slots=validateGenerationSlots(data.slots);
 const settings=(await db(env,'editorial_settings?order=id.desc&limit=1'))[0];
 if(!settings)return json({error:'先に投稿方針を保存してください'},400);
 const snapshot=await db(env,'rpc/generation_snapshot','POST',{p_slots:slots.map(s=>s.prompt_id),p_times:slots.map(s=>s.time)});
 snapshot.target_date=target;
 let prompt=generationPrompt(settings.content,snapshot);
 if(env.AI_HISTORY_ENABLED==='true'){const {historyContext,buildHistoryInput}=await import('./ai-generation.js');prompt=buildHistoryInput({kind:'production',target_date:target,settings_snapshot:settings.content,prompt_snapshot:snapshot},await historyContext(env,db,target),await db(env,'rpc/ai_month_usage','POST',{})).prompt;}
 return json({prompt,count:slots.length,target_date:target,mode:'production'});
 }
 if(path==='/api/threads/token/refresh'){
 if(m.role!=='admin')return json({error:'接続の更新は管理者のみ可能です'},403);
 await initializeToken(env,db);
 const result=await refreshThreadsToken(env,db);
 return json({...result,connection:await tokenStatus(env,db)});
 }
 if(path==='/api/metrics/refresh'){
 if(m.role!=='admin')return json({error:'反響の更新は管理者のみ可能です'},403);
 const connectedEnv=await threadsEnvironment(env,db);
 await checkThreadsConnection(connectedEnv);
 return json(await collectMetrics(connectedEnv,db));
 }
 if(path==='/api/publish-now'){
 if(m.role!=='admin')return json({error:'即時投稿は管理者のみ可能です'},403);
 if(!immediateReady(env))return json({error:'即時投稿は接続準備中です'},503);
 if(!/^[0-9a-f-]{36}$/i.test(data.id)||!Number.isInteger(data.version))return json({error:'投稿情報が不正です'},400);
 const connectedEnv=await threadsEnvironment(env,db);
 const post=await db(env,'rpc/claim_immediate_post','POST',{p_actor:m.user_id,p_id:data.id,p_version:data.version});
 return json(await publishClaim(connectedEnv,post,db));
 }
 if(path==='/api/generate'){
 if(!env.MAKE_AI_TOKEN&&!(env.AI_HISTORY_ENABLED==='true'&&env.OPENAI_API_KEY))return json({error:'AI生成は接続準備中です'},503);
 if(data.slots!==undefined){
 const target=validateGenerationDate(data.target_date??new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10));
 const slots=validateGenerationSlots(data.slots,target);
 return json(await db(env,'rpc/request_configured_generation','POST',{p_actor:m.user_id,p_target:target,p_slots:slots.map(s=>s.prompt_id),p_times:slots.map(s=>s.time)}));
 }
 return json(data.target_date===undefined?await db(env,'rpc/request_generation_job','POST',{p_actor:m.user_id}):await db(env,'rpc/request_generation_for_date','POST',{p_actor:m.user_id,p_target:validateGenerationDate(data.target_date)}));
 }
 if(path==='/api/settings'){
 if(m.role!=='admin')return json({error:'投稿方針の変更は管理者のみ可能です。'},403);
 if(!data||typeof data!=='object'||Array.isArray(data))return json({error:'設定形式が不正です'},400);
 return json(await db(env,'editorial_settings','POST',{content:data,created_by:m.user_id}));
 }
 if(path==='/api/posts'){
 const action=data.action;if(!['create','edit','approve','cancel'].includes(action))return json({error:'操作が不正です'},400);
 if(action!=='create'&&(!/^[0-9a-f-]{36}$/i.test(data.id)||!Number.isInteger(data.version)))return json({error:'投稿IDまたは版番号が不正です'},400);
 if(['approve','cancel'].includes(action)&&m.role!=='admin')return json({error:'承認・取消は管理者のみ可能です'},403);
 const args={p_actor:m.user_id,p_action:action,p_id:data.id||null,p_version:data.version||null};
 if(['create','edit'].includes(action))Object.assign(args,validatePost(data));
 return json(await db(env,'rpc/mutate_post','POST',args));
 }
 return json({error:'見つかりません'},404);
 }catch(error){return json({error:error instanceof SyntaxError?'入力形式が不正です':error.message},400);}
}};
