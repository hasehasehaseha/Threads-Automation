export function setupBulkApproval({api,safe,msg,getState,reload,when,show}){
 const $=s=>document.querySelector(s);let candidates=[],selected=new Set(),busy=false,requestId=null,execution=0;
 const panel=document.createElement('article');panel.id='bulk-approval';panel.hidden=true;
 panel.innerHTML='<h2>下書きの一括承認</h2><p>投稿時刻が未来の下書きを、早い時刻から選びます。承認すると、各予約時刻に @neis_hiroshima へ自動公開されます。日時未指定・時刻を過ぎた投稿は対象外です。</p><form id="bulk-preview-form"><div class="form-grid"><label>対象の選び方<select id="bulk-mode"><option value="count">件数を指定</option><option value="date">指定日まで</option></select></label><label id="bulk-count-label">確認する件数（最大100件）<input id="bulk-count" type="number" min="1" max="100" value="10" required></label><label id="bulk-date-label" hidden>この日まで（日本時間・当日を含む）<input id="bulk-end" type="date"></label></div><div class="actions"><button id="bulk-ten" type="button">10件</button><button id="bulk-hundred" type="button">100件</button><button id="bulk-seven-days" type="button">7日先まで</button><button id="bulk-preview" class="primary">対象を確認</button></div></form><div id="bulk-results" aria-live="polite"></div>';
 $('#post-list').before(panel);
 const jump=document.createElement('button');jump.type='button';jump.textContent='下書きの一括承認へ';jump.hidden=true;$('#workspace > .actions').append(jump);
 jump.onclick=()=>{show('posts');panel.scrollIntoView({behavior:'smooth',block:'start'});};
 const day=offset=>new Date(Date.now()+9*3600000+offset*86400000).toISOString().slice(0,10);
 $('#bulk-end').value=day(7);
 function settingsChanged(){execution++;candidates=[];selected.clear();requestId=null;draw();}
 function mode(){const date=$('#bulk-mode').value==='date';$('#bulk-count-label').hidden=date;$('#bulk-date-label').hidden=!date;$('#bulk-count').required=!date;$('#bulk-end').required=date;}
 $('#bulk-mode').onchange=()=>{mode();settingsChanged();};
 $('#bulk-count').oninput=settingsChanged;$('#bulk-end').onchange=settingsChanged;
 for(const [id,count] of [['bulk-ten',10],['bulk-hundred',100]])$('#'+id).onclick=()=>{$('#bulk-mode').value='count';$('#bulk-count').value=count;mode();settingsChanged();};
 $('#bulk-seven-days').onclick=()=>{$('#bulk-mode').value='date';$('#bulk-end').value=day(7);mode();settingsChanged();};
 function lock(){for(const el of panel.querySelectorAll('input,select,button'))el.disabled=busy;}
 function draw(hasMore=false){
  const root=$('#bulk-results');root.replaceChildren();
  if(!requestId){lock();return;}
  const summary=document.createElement('p');summary.textContent='候補'+candidates.length+'件 ／ 選択中'+selected.size+'件'+(hasMore?'。この条件には続きがあります。1回に扱える候補は最大100件です。':'');root.append(summary);
  const note=document.createElement('p');note.className='post-meta';note.textContent='チェックを外して対象を絞れます。各投稿の「本文を確認」で内容を確認してください。同時刻の重複と1日7件の上限も承認時に再確認します。';root.append(note);
  const all=document.createElement('button');all.type='button';all.textContent='承認可能な候補をすべて選択';const none=document.createElement('button');none.type='button';none.textContent='選択を解除';
  all.onclick=()=>{selected=new Set(candidates.filter(p=>!p.reason).map(p=>p.id));requestId=crypto.randomUUID();draw(hasMore);};none.onclick=()=>{selected.clear();requestId=crypto.randomUUID();draw(hasMore);};
  const actions=document.createElement('div');actions.className='actions';actions.append(all,none);root.append(actions);
  for(const p of candidates){
   const row=document.createElement('div');row.className='bulk-candidate';
   const label=document.createElement('label');label.className='check-label';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(p.id);check.disabled=!!p.reason||busy;
   check.onchange=()=>{if(check.checked)selected.add(p.id);else selected.delete(p.id);requestId=crypto.randomUUID();draw(hasMore);};
   const text=document.createElement('span');text.textContent=when(p.scheduled_at)+' ／ '+(p.topic||'テーマ未設定')+(p.reason?' ／ 対象外：'+p.reason:'');label.append(check,text);row.append(label);
   const details=document.createElement('details'),title=document.createElement('summary'),body=document.createElement('p');title.textContent='本文を確認';body.className='post-body';body.textContent=p.body;details.append(title,body);row.append(details);root.append(row);
  }
  const submit=document.createElement('button');submit.id='bulk-approve';submit.className='primary';submit.type='button';submit.disabled=busy||!selected.size;submit.textContent='選択した'+selected.size+'件を承認して予約';
  submit.onclick=safe(async()=>{
   const run=++execution,posts=candidates.filter(p=>selected.has(p.id)).map(p=>({id:p.id,version:p.version})),id=requestId;
   busy=true;lock();
   try{const result=await api('posts/bulk-approve',{request_id:id,posts});if(run!==execution||!getState())return;requestId=null;candidates=[];selected.clear();await reload();msg(result.approved+'件を承認し、予約に設定しました。各予約時刻に自動公開されます。');}
   finally{if(run===execution){busy=false;draw(hasMore);}}
  });root.append(submit);
  lock();
  // Preserve exclusions and empty-selection state after toggling the busy controls.
  [...panel.querySelectorAll('.bulk-candidate input')].forEach((el,i)=>el.disabled=busy||!!candidates[i].reason);submit.disabled=busy||!selected.size;
 }
 $('#bulk-preview-form').onsubmit=safe(async()=>{
  const run=++execution,data=$('#bulk-mode').value==='date'?{mode:'date',end_date:$('#bulk-end').value}:{mode:'count',count:Number($('#bulk-count').value)};
  busy=true;lock();
  try{const result=await api('posts/bulk-preview',data);if(run!==execution||!getState())return;candidates=result.candidates;selected=new Set(candidates.filter(p=>!p.reason).map(p=>p.id));requestId=crypto.randomUUID();busy=false;draw(result.hasMore);msg('対象を表示しました。内容と選択件数を確認してから承認してください。');}
  finally{if(run===execution){busy=false;lock();[...panel.querySelectorAll('.bulk-candidate input')].forEach((el,i)=>el.disabled=!!candidates[i]?.reason);if($('#bulk-approve'))$('#bulk-approve').disabled=!selected.size;}}
 });
 return {render(){const admin=getState()?.member.role==='admin';panel.hidden=!admin;jump.hidden=!admin;$('#bulk-end').min=day(0);},reset(){execution++;busy=false;candidates=[];selected.clear();requestId=null;panel.hidden=true;jump.hidden=true;draw();}};
}
