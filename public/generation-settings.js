export function setupGenerationStudio({api,safe,msg,item,when,reload,getState}){
 const $=s=>document.querySelector(s),labels={queued:'開始待ち（他の生成がある場合は順番待ち）',generating:'生成中',completed:'下書き保存済み',needs_review:'要確認（時刻超過や処理結果を確認してください）'};
 let dirty=false,version=null,rows=[],busy=false,pollTimer=null;
 const historyDetails=document.createElement('details'),historySummary=document.createElement('summary'),historyContent=document.createElement('div'),historyNote=document.createElement('p');historyDetails.id='completed-generation-history';historyNote.className='post-meta';historyNote.textContent='生成結果の記録です。投稿本文は下の「投稿一覧」で確認できます。';historyDetails.append(historySummary,historyNote,historyContent);
 const weeklyButton=document.createElement('button');weeklyButton.id='generate-week';weeklyButton.type='button';weeklyButton.disabled=true;
 $('#generate-date-form').append(weeklyButton);
 const weeklyNote=document.createElement('p');weeklyNote.className='post-meta';weeklyNote.textContent='週間生成は、上の指定日から7日間、選んだ件数・時刻・プロンプトを毎日繰り返します。ボタン操作から生成を開始し、1日分ずつ順番に処理します。先に作った下書きも履歴として参照します。続きは毎分確認するため、全日分の完了には数分〜数十分かかります。既存の依頼がある日は、その設定・生成結果を使います。';
 $('#generate-date-form').after(weeklyNote);
 const weeklyStatus=document.createElement('div');weeklyStatus.id='weekly-generation-status';weeklyStatus.setAttribute('aria-live','polite');$('#generation-status').before(weeklyStatus);
 const day=(offset=0)=>new Date(Date.now()+9*3600000+offset*86400000).toISOString().slice(0,10);
 const defaults={1:['12:00'],2:['08:00','20:00'],3:['08:00','12:00','20:00'],4:['08:00','12:00','16:00','20:00'],5:['08:00','11:00','14:00','17:00','20:00'],6:['08:00','10:00','12:00','15:00','18:00','20:00'],7:['08:00','10:00','12:00','14:00','16:00','18:00','20:00']};
 function capture(){for(const [i,row] of [...$('#generation-slots').children].entries())rows[i]={time:row.querySelector('input').value,prompt_id:row.querySelector('select').value};}
 function drawRows(){
  const state=getState(),templates=(state?.promptTemplates||[]).filter(t=>t.active),count=Number($('#generation-count').value),target=$('#generation-slots');target.replaceChildren();
  for(let i=0;i<count;i++){
   rows[i]??={time:defaults[count][i],prompt_id:state?.promptPlan?.slots[i]||templates[i%templates.length]?.id||''};
   const row=document.createElement('div');row.className='generation-slot';
   const title=document.createElement('strong');title.textContent='投稿'+(i+1);
   const timeLabel=document.createElement('label');timeLabel.textContent='投稿'+(i+1)+'の時刻（日本時間）';
   const input=document.createElement('input');input.type='time';input.required=true;input.value=rows[i].time;input.disabled=busy;timeLabel.append(input);
   const promptLabel=document.createElement('label');promptLabel.textContent='投稿'+(i+1)+'のプロンプト';
   const select=document.createElement('select');select.required=true;select.disabled=busy;
   const empty=document.createElement('option');empty.value='';empty.textContent='プロンプトを選択';select.append(empty);
   for(const t of templates){const o=document.createElement('option');o.value=t.id;o.textContent=((state.promptTemplates||[]).findIndex(p=>p.id===t.id)+1)+'. '+t.name;select.append(o);}
   select.value=rows[i].prompt_id;promptLabel.append(select);row.append(title,timeLabel,promptLabel);target.append(row);
  }
 }
 function slots(date){
  capture();const selected=rows.slice(0,Number($('#generation-count').value));
  if(selected.some(s=>!s.prompt_id||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)))throw new Error('各投稿の時刻とプロンプトを選んでください。');
  if(new Set(selected.map(s=>s.time)).size!==selected.length)throw new Error('投稿時刻が重複しています。');
  if(date&&selected.some(s=>new Date(date+'T'+s.time+':00+09:00')<=new Date()))throw new Error('今日分は、すべての投稿をこれからの時刻にしてください。');
  return selected;
 }
 function changeCount(value){$('#generation-count').value=value;capture();rows=[];dirty=true;drawRows();renderButtons();}
 $('#generation-count').onchange=e=>changeCount(e.target.value);
 $('#generation-run-count').onchange=e=>changeCount(e.target.value);
 $('#generation-slots').oninput=()=>{capture();dirty=true;};
 $('#generation-slots').onchange=()=>{capture();dirty=true;};
 function renderButtons(){
  const state=getState(),disabled=busy||!state?.generationEnabled||!state?.settings,n=Number($('#generation-count').value);
  for(const id of ['generate-drafts','generate-today','generate-date'])$('#'+id).disabled=disabled;
  $('#generate-drafts').textContent='翌日分の'+n+'件を生成';$('#generate-today').textContent='今日分の'+n+'件を生成';$('#generate-date').textContent='指定日の'+n+'件を生成';
  weeklyButton.textContent='1週間分（'+n+'件×7日＝'+(n*7)+'件）を生成';weeklyButton.disabled=disabled||!state?.ai;
  $('#generation-count').disabled=busy;$('#generation-date').disabled=busy;
  $('#generation-run-count').value=String(n);$('#generation-run-count').disabled=busy;
  $('#generation-slots').querySelectorAll('input,select').forEach(el=>{el.disabled=busy;});
  $('#save-generation-plan').disabled=busy||state?.member.role!=='admin';
 }
 async function generate(date){
  const selected=slots(date);busy=true;renderButtons();drawRows();
  try{
   let j=await api('generate',{target_date:date,slots:selected});await reload();
   if(!getState())return;
   if(j.status==='queued'&&getState().generationImmediateEnabled){
    msg('生成を開始しています。GPTの応答と履歴チェックをお待ちください。他の生成がある場合は順番に処理します。');
    try{await api('generate-start',{});}catch{await reload();throw new Error('依頼は保存されています。生成の状態を一覧で確認してください。自動で再生成はしません。');}
    await reload();if(!getState())return;
    j=getState().generationJobs.find(job=>job.id===j.id)||j;
   }
   const count=j.prompt_snapshot?.count||3;
   const differs=JSON.stringify(j.prompt_snapshot?.times)!==JSON.stringify(selected.map(s=>s.time))||JSON.stringify(j.prompt_snapshot?.templates?.map(t=>t.id))!==JSON.stringify(selected.map(s=>s.prompt_id))||count!==selected.length;
   msg(date+' 分：'+labels[j.status]+'（'+count+'件）。'+(differs?'既存の依頼があるため、その設定を使います。':'')+'公開には承認が必要です。');
  }finally{busy=false;renderButtons();drawRows();}
 }
 $('#generate-drafts').onclick=safe(()=>generate(day(1)));
 $('#generate-today').onclick=safe(()=>generate(day()));
 $('#generate-date-form').onsubmit=safe(()=>generate($('#generation-date').value));
 weeklyButton.onclick=safe(async()=>{
  const date=$('#generation-date').value,selected=slots(date);if(!date)throw new Error('週間生成の開始日を指定してください。');
  busy=true;renderButtons();
  try{
   const batch=await api('generate-week',{request_id:crypto.randomUUID(),start_date:date,slots:selected});
   if(!getState())return;
   await reload();const fresh=batch.new_job_ids.length;
   if(getState()?.generationImmediateEnabled){
    msg('週間生成を開始しています。1日分ずつ順番に処理します。');
    try{await api('generate-start',{});}catch{await reload();throw new Error('週間の依頼は保存されています。生成の状態を一覧で確認してください。');}
    await reload();if(!getState())return;
   }
   msg(date+'から7日間の生成を受け付けました。新規'+fresh+'日・既存'+(7-fresh)+'日。1日ずつ処理します。公開には承認が必要です。');
  }finally{busy=false;renderButtons();drawRows();}
 });
 $('#save-generation-plan').onclick=safe(async()=>{
  const selected=slots();busy=true;renderButtons();
  try{await api('generation-plan',{version,slots:selected});dirty=false;await reload();msg('投稿数・時刻・プロンプトの初期設定を保存しました。依頼済みの内容は変わりません。');}
  finally{busy=false;renderButtons();}
 });
 function render(){
  const state=getState();if(!state)return;
  if(!dirty){version=state.promptPlan?.version??null;rows=(state.promptPlan?.slots||[]).map((id,i)=>({prompt_id:id,time:state.promptPlan?.times?.[i]||defaults[3][i]}));$('#generation-count').value=String(rows.length||3);}
  const date=$('#generation-date');date.min=day();if(!date.value)date.value=day(1);
  drawRows();renderButtons();const target=$('#generation-status');target.replaceChildren();
  weeklyStatus.replaceChildren();historyContent.replaceChildren();
  for(const batch of state.generationBatches||[]){
   const jobs=batch.jobs||[],done=jobs.filter(j=>j.status==='completed'),review=jobs.filter(j=>j.status==='needs_review'),pending=jobs.filter(j=>['queued','generating'].includes(j.status));
   const end=jobs.at(-1)?.target_date||'',count=batch.prompt_snapshot.count,total=done.reduce((n,j)=>n+j.count,0);
   const card=item('週間生成 '+batch.start_date+'〜'+end,done.length+'/7日完了・保存済み'+total+'件'+(pending.length?' ／ 処理待ち・生成中 '+pending.length+'日':' ／ 処理終了')+(review.length?' ／ 要確認 '+review.length+'日':''));
   const plan=document.createElement('p');plan.className='post-meta';plan.textContent='依頼時：1日'+count+'件×7日＝'+(count*7)+'件 ／ 新規'+batch.new_job_ids.length+'日・既存'+(7-batch.new_job_ids.length)+'日（既存日はその設定を使用）';card.append(plan);
   for(const j of jobs){const p=document.createElement('p');p.className='post-meta';p.textContent=j.target_date+'：'+(j.status==='queued'?'順番待ち（毎分確認）':labels[j.status]||j.status)+'（'+j.count+'件）'+(j.new?'':'・既存の依頼')+(j.error?' ／ '+j.error:'');card.append(p);}
   if(jobs.length===7&&done.length===7)historyContent.append(card);else weeklyStatus.append(card);
  }
  for(const j of (state.generationJobs||[]).filter(j=>j.kind!=='test')){
   const snapshot=j.prompt_snapshot,count=snapshot?.count||3;
   const card=item(j.target_date+' 分 · '+count+'件',labels[j.status]||j.status);
   if(j.ai_report){const p=document.createElement('p');p.className='post-meta';p.textContent=j.ai_report.model+' ／ 履歴'+j.ai_report.historyCount+'件を確認・指示に'+j.ai_report.includedCount+'件を参照'+(j.ai_report.retried?' ／ 類似のため1回再生成':'');card.append(p);}
   if(j.test_error){const p=document.createElement('p');p.textContent=j.test_error;card.append(p);}
   if(j.status==='needs_review'&&j.preview_posts)for(const post of j.preview_posts){const p=document.createElement('p');p.className='post-body';p.textContent=post.body;card.append(p);}
   if(snapshot?.templates){const p=document.createElement('p');p.className='post-meta';p.textContent=snapshot.templates.map((t,i)=>(snapshot.times?.[i]||defaults[3][i])+' '+t.name).join(' ／ ');card.append(p);}if(j.status==='completed')historyContent.append(card);else target.append(card);
  }
  if(historyContent.childElementCount){historySummary.textContent='下書き保存済みの生成履歴（'+historyContent.childElementCount+'件の記録）';target.append(historyDetails);}
  if(!pollTimer&&((state.generationJobs||[]).some(j=>j.kind!=='test'&&['queued','generating'].includes(j.status))||(state.generationBatches||[]).some(b=>b.jobs?.some(j=>['queued','generating'].includes(j.status))))){pollTimer=setTimeout(async()=>{pollTimer=null;try{if(getState())await reload();}catch{}},3000);}
 }
 return {render,previewRequest:()=>({target_date:$('#generation-date').value,slots:slots()}),reset(){dirty=false;version=null;rows=[];busy=false;if(pollTimer)clearTimeout(pollTimer);pollTimer=null;$('#generation-slots').replaceChildren();weeklyStatus.replaceChildren();historyDetails.open=false;historyContent.replaceChildren();$('#generation-status').replaceChildren();}};
}
