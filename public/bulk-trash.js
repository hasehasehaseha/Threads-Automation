export function setupBulkDraftTrash({root,api,safe,msg,reload,getState,redraw,when}){
 const panel=document.createElement('div');panel.id='bulk-trash-controls';panel.hidden=true;root.querySelector('.post-browser').append(panel);
 let selected=new Map(),requestId=null,confirming=false,busy=false,execution=0,source=[];
 function clear(){selected.clear();requestId=null;confirming=false;}
 function change(){requestId=crypto.randomUUID();confirming=false;redraw();}
 function button(text,fn,disabled=false){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=disabled||busy;b.onclick=fn;return b;}
 return {
  clear,
  prune(posts){source=posts;const current=new Map(posts.map(p=>[p.id,p]));let changed=false;for(const [id,version] of selected){const p=current.get(id);if(!p||p.deleted_at||p.status!=='draft'||p.version!==version){selected.delete(id);changed=true;}}if(changed){requestId=crypto.randomUUID();confirming=false;}},
  checkbox(p){const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');label.className='check-label bulk-trash-select';input.type='checkbox';input.checked=selected.has(p.id);input.disabled=busy||(!input.checked&&selected.size>=100);input.setAttribute('aria-label',(p.topic||'テーマ未設定')+'を一括移動の対象に選択');input.onchange=()=>{if(input.checked&&selected.size<100)selected.set(p.id,p.version);else selected.delete(p.id);change();};text.textContent='移動対象に選択';label.append(input,text);return label;},
  render(matches,pagePosts,enabled){
   panel.hidden=!enabled;panel.replaceChildren();if(!enabled)return;
   const note=document.createElement('p');note.textContent='下書きを選んでまとめてごみ箱へ移動できます（1回最大100件）。移動後は「ごみ箱」から復元できます。';panel.append(note);
   const actions=document.createElement('div');actions.className='actions';
   actions.append(button('このページを選択',()=>{for(const p of pagePosts){if(selected.size>=100)break;selected.set(p.id,p.version);}change();},!pagePosts.length),button('絞り込み結果の'+Math.min(matches.length,100)+'件を選択',()=>{selected=new Map(matches.slice(0,100).map(p=>[p.id,p.version]));change();},!matches.length),button('選択を解除',()=>{clear();redraw();},!selected.size));panel.append(actions);
   const status=document.createElement('p');status.id='bulk-trash-selection-count';status.setAttribute('aria-live','polite');status.textContent='選択中：'+selected.size+'件'+(matches.length>100?' ／ 絞り込み結果から先頭100件までをまとめて選択します。':'');panel.append(status);
   if(!confirming){const next=button('選択した'+selected.size+'件をごみ箱へ',()=>{confirming=true;redraw();},!selected.size);next.id='bulk-trash-review';next.className='danger';panel.append(next);}
   else{
    const box=document.createElement('div');box.id='bulk-trash-confirm';box.className='trash-confirm';const text=document.createElement('p');text.textContent='選択した'+selected.size+'件の下書きをごみ箱へ移動します。投稿予定の一覧とAIの履歴参照から外れます。完全削除はせず、後から復元できます。';box.append(text);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='移動する投稿を確認（'+selected.size+'件）';details.append(summary);for(const p of source.filter(p=>selected.has(p.id))){const row=document.createElement('p');row.className='post-meta';row.textContent=when(p.scheduled_at)+' ／ '+(p.topic||'テーマ未設定')+' ／ '+p.body;details.append(row);}box.append(details);
    const submit=button(selected.size+'件をごみ箱へ移動する',safe(async()=>{
     const run=++execution,id=requestId,posts=[...selected].map(([id,version])=>({id,version}));busy=true;redraw();
     try{const result=await api('posts/bulk-trash',{request_id:id,posts});if(run!==execution||!getState())return;clear();await reload();msg(result.moved+'件の下書きをごみ箱へ移動しました。ごみ箱から復元できます。');}
     finally{if(run===execution){busy=false;redraw();}}
    }),!selected.size);submit.id='bulk-trash-submit';submit.className='danger';box.append(submit,button('やめる',()=>{confirming=false;redraw();}));panel.append(box);
   }
   if(busy)for(const el of root.querySelectorAll('input,select,button'))el.disabled=true;
  },
  reset(){execution++;busy=false;clear();source=[];panel.hidden=true;panel.replaceChildren();}
 };
}
