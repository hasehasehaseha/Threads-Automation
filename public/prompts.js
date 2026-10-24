// Loaded by app.js with the existing authenticated API; no new browser credentials.
export function setupPromptStudio({api,safe,msg,item,when,reload,getState,show,getGenerationPreview}){
 const $=s=>document.querySelector(s);let editing=null,dirty=false,polling=false,planDirty=false,planVersion=null,testing=false,currentJob=null,execution=0;
 const savedPreviews=new Set();
 const form=$('#template-form');
 const values=()=>({...Object.fromEntries(new FormData(form)),active:form.elements.active.checked});
 function edit(t=null){editing=t;form.reset();form.elements.active.checked=t?.active??true;for(const k of ['name','category','instructions'])form.elements[k].value=t?.[k]||'';dirty=false;$('#template-mode').textContent=t?'編集中：'+t.name:'新しいプロンプト';$('#test-prompt-preview').textContent='';currentJob=null;renderCurrent();}
 form.addEventListener('input',()=>{dirty=true;});
 $('#new-template').onclick=()=>{if(dirty&&!confirm('編集中のプロンプトを破棄して新規入力に戻りますか？'))return;edit();};
 form.onsubmit=safe(async()=>{
  const result=await api('prompts',{...values(),id:editing?.id,version:editing?.version});
  edit(Array.isArray(result)?result[0]:result);await reload();msg('プロンプトを保存しました。既存の投稿や依頼済みの生成には影響しません。');
 });
 $('#preview-template-prompt').onclick=safe(async()=>{
  const r=await api('prompts/production-preview',getGenerationPreview());
  $('#test-prompt-preview').textContent='通常投稿用の新規生成プレビュー：'+r.target_date+' ／ '+r.count+'件\n投稿管理で選択中の件数・時刻と、保存済みのプロンプトを使用します。依頼済みの内容は変わりません。\n\n'+r.prompt;
 });
 $('#preview-test-prompt').onclick=safe(async()=>{const r=await api('prompts/preview',values());$('#test-prompt-preview').textContent='テスト生成用（1件）・現在の未保存の入力を使用\n通常投稿の件数設定とは別の確認用です。\n\n'+r.prompt;});
 function renderCurrent(){
  const panel=$('#current-test-result');panel.replaceChildren();panel.setAttribute('aria-busy',String(testing));
  const title=document.createElement('h3');title.textContent='今回のテスト結果';panel.append(title);
  if(testing){const p=document.createElement('p');p.textContent='1件の投稿文を生成しています。完了するとここに表示します。';panel.append(p);return;}
  if(!currentJob){const p=document.createElement('p');p.textContent='「この入力でテスト生成」を押すと、この場所に1件の投稿文が表示されます。';panel.append(p);return;}
  if(currentJob.test_error){const p=document.createElement('p');p.textContent=currentJob.test_error;panel.append(p);}
  for(const v of currentJob.preview_posts||[]){
   const p=document.createElement('p');p.className='post-body';p.textContent=v.body;panel.append(p);
  }
  if(currentJob.status==='generating'&&!testing){const p=document.createElement('p');p.textContent='前回のテストを処理中です。「最新の結果に更新」で履歴を確認してください。';panel.append(p);}
 }
 $('#test-template').onclick=safe(async()=>{
  const run=++execution,data={...values(),request_id:crypto.randomUUID()};testing=true;currentJob=null;render();
  msg('テストの文章を1件生成しています。結果はこのボタンの下に表示されます。');
  try{const result=await api('prompts/test',data);if(run!==execution)return;currentJob=result;testing=false;renderCurrent();
   msg(currentJob.status==='completed'?'1件のテスト結果を表示しました。':currentJob.test_error||'テストの処理状況を履歴で確認してください。');
   try{await reload();}catch{msg('テスト結果をこの画面に表示しました。共有履歴の再読み込みは後でもう一度お試しください。');}
  }catch(error){if(run!==execution)return;currentJob={status:'needs_review',test_error:error.message};throw error;}
  finally{if(run===execution){testing=false;render();}}
 });
 $('#refresh-tests').onclick=safe(reload);
 function render(){
  const state=getState();if(!state)return;
  const admin=state.member.role==='admin';$('#save-template').disabled=!admin;
  $('#test-template').disabled=testing||!state.testEnabled||!state.settings;
  $('#new-template').disabled=testing;$('#save-template').disabled=testing||!admin;renderCurrent();
  $('#prompt-editor-note').textContent=admin?'管理者はプロンプトを保存できます。テストは保存前の入力でも実行できます。':'保存・使い分けの設定は管理者が行います。スタッフも入力を変えてテストできます。';
  const tabs=$('#prompt-tabs');tabs.replaceChildren();
  for(const [i,t] of (state.promptTemplates||[]).entries()){
   const b=document.createElement('button');b.type='button';b.disabled=testing;b.textContent=(i+1)+'. '+t.name;b.classList.toggle('active',editing?.id===t.id);b.setAttribute('aria-pressed',String(editing?.id===t.id));
   b.onclick=()=>{if(dirty&&!confirm('編集中の内容を破棄して切り替えますか？'))return;edit(t);render();};tabs.append(b);
  }
  const library=$('#template-list');library.replaceChildren();
  for(const t of state.promptTemplates||[]){
   const a=item(t.name+' · '+t.category+(t.active?'':' · 使用停止'),t.instructions),b=document.createElement('button');b.textContent='編集・テスト';b.disabled=testing;
   b.onclick=()=>{if(dirty&&!confirm('現在の編集中の内容を破棄して切り替えますか？'))return;edit(t);render();form.scrollIntoView({behavior:'smooth'});};a.append(b);library.append(a);
  }
  const history=$('#prompt-test-history');history.replaceChildren();
  const jobs=(state.generationJobs||[]).filter(j=>j.kind==='test');
  if(!jobs.length)history.append(item('テスト結果はまだありません','プロンプトを選び、「この入力でテスト生成」を押してください。'));
  const status={queued:'生成待ち（最大15分）',generating:'生成中',completed:'テスト完了・未公開',needs_review:'要確認（自動で再生成しません）'};
  for(const j of jobs){
   if(currentJob?.id===j.id&&j.status==='completed'&&!currentJob.preview_posts?.length){currentJob=j;renderCurrent();}
   const t=j.prompt_snapshot?.templates?.[0],a=item((t?.name||'プロンプトテスト')+' · '+status[j.status],when(j.created_at));
   const details=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('pre');summary.textContent='このテストで使ったプロンプト';p.textContent=(t?.instructions||'')+(j.prompt_snapshot?.brief?'\n\n今回の補足：'+j.prompt_snapshot.brief:'');details.append(summary,p);a.append(details);if(j.test_error){const error=document.createElement('p');error.textContent=j.test_error;a.append(error);}
   for(const [i,v] of (j.preview_posts||[]).entries()){
    const result=item('案'+(i+1)+' · '+v.topic,v.body),save=document.createElement('button'),previewKey=j.id+':'+i;
    save.disabled=savedPreviews.has(previewKey);save.textContent=save.disabled?'下書きに保存済み':'下書きに保存';
    save.onclick=safe(async()=>{save.disabled=true;try{await api('posts',{action:'create',body:v.body,topic:v.topic,planned:'',settings_id:null});savedPreviews.add(previewKey);await reload();msg('日時未指定の下書きへ保存しました。公開には別途承認が必要です。');}catch(e){save.disabled=savedPreviews.has(previewKey);throw e;}});
    result.append(save);a.append(result);
   }
   history.append(a);
  }
  if(!polling&&jobs.some(j=>['queued','generating'].includes(j.status))){polling=true;setTimeout(async()=>{try{if(getState())await reload();}catch{}finally{polling=false;if(getState()?.generationJobs?.some(j=>j.kind==='test'&&['queued','generating'].includes(j.status)))render();}},15000);}
 }
 return {render,reset:()=>{execution++;testing=false;edit();planDirty=false;planVersion=null;savedPreviews.clear();$('#template-list').replaceChildren();$('#prompt-test-history').replaceChildren();}};
}
