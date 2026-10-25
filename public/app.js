import {setupPostList} from './post-list.js';
import {setupGenerationStudio} from './generation-settings.js';
import {setupPromptStudio} from './prompts.js';
import {setupAiSettings} from './ai-settings.js';
import {setupBulkApproval} from './bulk-approval.js';
const $=s=>document.querySelector(s);let config,token=null,state=null,editing=null;
const msg=t=>$('#status').textContent=t;
const labels={draft:'下書き',scheduled:'承認済み・予約待ち',publishing:'公開処理中',published:'公開済み',failed:'失敗',needs_review:'要確認'};
const when=t=>t?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short'}).format(new Date(t))+' JST':'日時未指定';
async function api(path,data){const r=await fetch('/api/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw new Error(v.error||'処理に失敗しました');return v;}
function safe(fn){return async e=>{e?.preventDefault();const button=e?.submitter;if(button)button.disabled=true;try{await fn(e);}catch(err){msg(err.message);}finally{if(button)button.disabled=false;}};}
function show(id){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==id);document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id));}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>show(b.dataset.page));
function item(title,text){const a=document.createElement('article'),h=document.createElement('h2'),p=document.createElement('p');h.textContent=title;p.textContent=text;p.className='post-body';a.append(h,p);return a;}
function renderPostCard(p){const a=item((p.topic||'テーマ未設定')+' · '+labels[p.status],p.body);const meta=document.createElement('p');meta.className='post-meta';meta.textContent=when(p.scheduled_at)+(p.last_error?' · '+p.last_error:'');a.append(meta);if(p.status==='draft'||(p.status==='scheduled'&&state.member.role==='admin')){const b=document.createElement('button');b.textContent='編集';b.onclick=()=>{editing=p;const f=$('#post-form');f.elements.body.value=p.body;f.elements.topic.value=p.topic;f.elements.planned.value=p.scheduled_at?new Date(new Date(p.scheduled_at).valueOf()+9*3600000).toISOString().slice(0,16):'';f.scrollIntoView();};a.append(b);}if(state.member.role==='admin'&&['draft','scheduled'].includes(p.status)){const b=document.createElement('button');b.textContent=p.status==='draft'?'承認して予約':'予約を取り消す';b.onclick=safe(async()=>{b.disabled=true;try{await api('posts',{id:p.id,version:p.version,action:p.status==='draft'?'approve':'cancel'});await reload();msg('更新しました。');}finally{b.disabled=false;}});a.append(b);}if(state.member.role==='admin'&&['draft','scheduled'].includes(p.status)){const now=document.createElement('button');now.textContent='今すぐ投稿';now.disabled=!state.immediateEnabled;now.title=state.immediateEnabled?'確認後にThreadsへ公開します':'即時投稿は接続準備中です';now.onclick=safe(async()=>{if(!confirm('@neis_hiroshima に今すぐ公開します。予約済みの場合は予約を置き換えます。'+String.fromCharCode(10,10)+p.body))return;now.disabled=true;msg('公開処理中です。再度押さずにお待ちください。');try{await api('publish-now',{id:p.id,version:p.version});await reload();msg('Threadsへ公開しました。');}catch(error){await reload();throw error;}});a.append(now);}return a;}

async function reload(){state=await api('state');$('#workspace').hidden=false;$('#login').hidden=true;$('#logout').hidden=false;$('#role').textContent=state.member.role==='admin'?'管理者':'編集スタッフ';$('#save-settings').disabled=state.member.role!=='admin';if(state.settings)for(const[k,v]of Object.entries(state.settings.content)){const el=$('#settings-form').elements.namedItem(k);if(el)el.value=v;}
 postList.render();
 const metrics=$('#metric-list');metrics.replaceChildren();if(!state.metrics.length)metrics.append(item('反響データは未取得です','Meta接続後に実際の数字を取得します。'));for(const m of state.metrics){const post=state.posts.find(p=>p.id===m.post_id);metrics.append(item(when(m.captured_at)+' · '+(post?.topic||'投稿'),['views','likes','replies','reposts','quotes','shares'].map((k,i)=>['閲覧','いいね','返信','再投稿','引用','シェア'][i]+': '+(m[k]??'未取得')).join(' / ')));}}
$('#login-form').onsubmit=safe(async e=>{if(!config?.ready)throw new Error('先にSupabaseの接続設定が必要です');const data=Object.fromEntries(new FormData(e.target));try{const r=await fetch(config.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.anonKey,'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error('ログインできませんでした。入力内容を確認してください。');token=result.access_token;await reload();msg('ログインしました。');}finally{e.target.elements.password.value='';}});
$('#logout').onclick=safe(async()=>{const old=token;token=null;state=null;editing=null;$('#workspace').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;$('#metric-list').replaceChildren();$('#post-form').reset();$('#settings-form').reset();$('#prompt').textContent='';if(old)await fetch(config.supabaseUrl+'/auth/v1/logout',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+old}});msg('ログアウトしました。');});
const generationLabels={queued:'生成待ち（開始まで最大15分程度）',generating:'生成中',completed:'下書き保存済み',needs_review:'要確認（自動再生成はしません）'};
function renderGeneration(){generationStudio.render();}
const reloadData=reload;reload=async()=>{await reloadData();renderGeneration();$('#refresh-metrics').disabled=state.member.role!=='admin'||!state.metricsEnabled;$('#connection').textContent='共有保存：接続済み ／ 通常のAI生成：'+(state.generationEnabled?'利用可能（依頼後最大15分）':'準備中')+' ／ テスト：'+(state.testEnabled?'即時生成・1件':'接続準備中')+' ／ 即時投稿：'+(state.immediateEnabled?'利用可能':'準備中')+' ／ 予約配信：'+(state.automationEnabled?'有効（自由な時刻・毎分確認）':'停止中');};
const reloadWithConnection=reload;reload=async()=>{await reloadWithConnection();
 const t=state.threadsToken,labels={healthy:'自動更新は正常です',pending:'最初の更新を待っています',error:'更新の再確認が必要です',reconnect:'Threadsの再接続が必要です',uninitialized:'初期設定が必要です'};
 $('#threads-token-status').textContent=t?.enabled?[(labels[t.status]||'確認中')+'。毎日21:30に確認し、更新成功から7日後に次の更新を行います。','有効期限：'+(t.expiresAt?when(t.expiresAt):'初回更新後に確認'),'最終更新：'+(t.refreshedAt?when(t.refreshedAt):'未更新'),'次回更新対象：'+(t.nextAttemptAt?when(t.nextAttemptAt):'未設定'),t.lastError||''].filter(Boolean).join(' ／ '):'トークン自動更新は接続準備中です。';
 $('#refresh-threads-token').disabled=state.member.role!=='admin'||!t?.enabled||t.status==='reconnect';
};
$('#refresh-threads-token').onclick=safe(async()=>{const b=$('#refresh-threads-token');b.disabled=true;try{const r=await api('threads/token/refresh',{});await reload();msg(r.state==='refreshed'?'Threadsトークンを更新して安全に保存しました。':r.state==='error'?r.error:'次回更新対象時刻に自動確認します。');}finally{b.disabled=state?.member.role!=='admin'||!state?.threadsToken?.enabled||state.threadsToken.status==='reconnect';}});
$('#refresh-metrics').onclick=safe(async()=>{const b=$('#refresh-metrics');b.disabled=true;try{const r=await api('metrics/refresh',{});await reload();msg(r.total===0?'この管理画面からの公開済み投稿はまだありません。':`反響を${r.saved}件取得しました。取得済み${r.skipped}件、取得失敗${r.failed}件。`);}finally{b.disabled=false;}});
$('#reload').onclick=safe(reload);
$('#reset-post').onclick=()=>{editing=null;$('#post-form').reset();};
$('#post-form').onsubmit=safe(async e=>{const data=Object.fromEntries(new FormData(e.target));await api('posts',{...data,action:editing?'edit':'create',id:editing?.id,version:editing?.version,settings_id:state.settings?.id||null});editing=null;e.target.reset();await reload();msg('下書きを保存しました。');});
$('#settings-form').onsubmit=safe(async e=>{await api('settings',Object.fromEntries(new FormData(e.target)));await reload();msg('投稿方針を保存しました。');});
$('#preview-prompt').onclick=()=>show('prompts');
const generationStudio=setupGenerationStudio({api,safe,msg,item,when,reload:()=>reload(),getState:()=>state});
$('#logout').addEventListener('click',()=>generationStudio.reset());
const promptStudio=setupPromptStudio({api,safe,msg,item,when,reload:()=>reload(),getState:()=>state,show,getGenerationPreview:()=>generationStudio.previewRequest()});
$('#logout').addEventListener('click',()=>promptStudio.reset());
const reloadBeforePrompts=reload;reload=async()=>{await reloadBeforePrompts();promptStudio.render();};
const aiStudio=setupAiSettings({api,safe,msg,getState:()=>state,reload:()=>reload()});
$('#logout').addEventListener('click',()=>aiStudio.reset());
const reloadBeforeAi=reload;reload=async()=>{await reloadBeforeAi();aiStudio.render();};
const bulkApproval=setupBulkApproval({api,safe,msg,getState:()=>state,reload:()=>reload(),when,show});
$('#logout').addEventListener('click',()=>bulkApproval.reset());
const reloadBeforeBulk=reload;reload=async()=>{await reloadBeforeBulk();bulkApproval.render();};
const postList=setupPostList({renderCard:renderPostCard,getState:()=>state,show});
$('#logout').addEventListener('click',()=>postList.reset());
try{const r=await fetch('/api/config');if(!r.ok)throw new Error();config=await r.json();$('#connection').textContent=config.ready?'共有データ保存に接続済みです。ログイン後に各機能の状態を確認できます。':'Supabase未接続です。接続設定後にスタッフログインを開始できます。';$('#login-form').querySelector('button').disabled=!config.ready;}catch{$('#connection').textContent='サーバーに接続できません。Cloudflareへの配信状態を確認してください。';$('#login-form').querySelector('button').disabled=true;}

