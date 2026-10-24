// Loaded by app.js with the existing authenticated API; no new browser credentials.
export function setupPromptStudio({api,safe,msg,item,when,reload,getState,show}){
 const $=s=>document.querySelector(s);let editing=null,dirty=false,polling=false,planDirty=false,planVersion=null;
 const savedPreviews=new Set();
 const form=$('#template-form');
 const values=()=>({...Object.fromEntries(new FormData(form)),active:form.elements.active.checked});
 function edit(t=null){editing=t;form.reset();form.elements.active.checked=t?.active??true;for(const k of ['name','category','instructions'])form.elements[k].value=t?.[k]||'';dirty=false;$('#template-mode').textContent=t?'編集中：'+t.name:'新しいプロンプト';$('#test-prompt-preview').textContent='';}
 form.addEventListener('input',()=>{dirty=true;});
 $('#new-template').onclick=()=>{if(dirty&&!confirm('編集中のプロンプトを破棄して新規入力に戻りますか？'))return;edit();};
 form.onsubmit=safe(async()=>{
  const result=await api('prompts',{...values(),id:editing?.id,version:editing?.version});
  edit(Array.isArray(result)?result[0]:result);await reload();msg('プロンプトを保存しました。既存の投稿や依頼済みの生成には影響しません。');
 });
 $('#preview-template-prompt').onclick=safe(async()=>{const r=await api('prompts/preview',values());$('#test-prompt-preview').textContent=r.prompt;});
 $('#test-template').onclick=safe(async()=>{
  const b=$('#test-template');b.disabled=true;
  try{await api('prompts/test',values());await reload();msg('テストを依頼しました。保存前の入力内容を使い、公開せずに3案を作ります。最大15分ほどかかります。');}
  finally{b.disabled=!getState()?.generationEnabled;}
 });
 $('#prompt-plan-form').onchange=()=>{planDirty=true;};
 $('#prompt-plan-form').onsubmit=safe(async e=>{
  const f=e.target;await api('prompts/plan',{version:planVersion,slots:[f.elements.slot0.value,f.elements.slot1.value,f.elements.slot2.value]});planDirty=false;await reload();msg('3投稿のプロンプト設定を保存しました。次の新しい生成依頼から使います。');
 });
 $('#refresh-tests').onclick=safe(reload);
 function render(){
  const state=getState();if(!state)return;
  const admin=state.member.role==='admin';$('#save-template').disabled=!admin;$('#save-prompt-plan').disabled=!admin;
  $('#test-template').disabled=!state.generationEnabled||!state.settings;
  $('#prompt-editor-note').textContent=admin?'管理者はプロンプトを保存できます。テストは保存前の入力でも実行できます。':'保存・使い分けの設定は管理者が行います。スタッフも入力を変えてテストできます。';
  const library=$('#template-list');library.replaceChildren();
  for(const t of state.promptTemplates||[]){
   const a=item(t.name+' · '+t.category+(t.active?'':' · 使用停止'),t.instructions),b=document.createElement('button');b.textContent='編集・テスト';
   b.onclick=()=>{if(dirty&&!confirm('現在の編集中の内容を破棄して切り替えますか？'))return;edit(t);form.scrollIntoView({behavior:'smooth'});};a.append(b);library.append(a);
  }
  const f=$('#prompt-plan-form');if(!planDirty)planVersion=state.promptPlan?.version??null;
  for(let i=0;i<3;i++){
   const select=f.elements['slot'+i];if(planDirty)continue;select.replaceChildren();
   for(const t of (state.promptTemplates||[]).filter(t=>t.active)){
    const o=document.createElement('option');o.value=t.id;o.textContent=t.category+'：'+t.name;select.append(o);
   }
   if(state.promptPlan?.slots[i])select.value=state.promptPlan.slots[i];select.disabled=!admin;
  }
  const history=$('#prompt-test-history');history.replaceChildren();
  const jobs=(state.generationJobs||[]).filter(j=>j.kind==='test');
  if(!jobs.length)history.append(item('テスト結果はまだありません','プロンプトを選び、「この入力でテスト生成」を押してください。'));
  const status={queued:'生成待ち（最大15分）',generating:'生成中',completed:'テスト完了・未公開',needs_review:'要確認（自動で再生成しません）'};
  for(const j of jobs){
   const t=j.prompt_snapshot?.templates?.[0],a=item((t?.name||'プロンプトテスト')+' · '+status[j.status],when(j.created_at));
   const details=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('pre');summary.textContent='このテストで使ったプロンプト';p.textContent=(t?.instructions||'')+(j.prompt_snapshot?.brief?'\n\n今回の補足：'+j.prompt_snapshot.brief:'');details.append(summary,p);a.append(details);
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
 return {render,reset:()=>{edit();planDirty=false;planVersion=null;savedPreviews.clear();$('#template-list').replaceChildren();$('#prompt-test-history').replaceChildren();}};
}
