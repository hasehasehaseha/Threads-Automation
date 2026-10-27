import {setupBulkDraftTrash} from './bulk-trash.js';
const groups={upcoming:'投稿予定',draft:'下書き',published:'投稿済み',attention:'要確認・失敗',all:'すべて',trash:'ごみ箱'};
export function selectPosts(posts,{group='upcoming',date='',query=''}={}){
 const now=Date.now(),q=query.trim().toLocaleLowerCase();
 return posts.filter(p=>{
  if(group==='trash'?!p.deleted_at:!!p.deleted_at)return false;
  const status=group==='all'||group==='trash'||(group==='upcoming'?['scheduled','publishing'].includes(p.status)||(p.status==='draft'&&new Date(p.scheduled_at).valueOf()>now):group==='attention'?['failed','needs_review'].includes(p.status):p.status===group);
  const day=p.scheduled_at?new Date(new Date(p.scheduled_at).valueOf()+9*3600000).toISOString().slice(0,10):'';
  return status&&(!date||day===date)&&(!q||((p.topic||'')+' '+p.body).toLocaleLowerCase().includes(q));
 }).sort((a,b)=>{const ta=new Date(a.scheduled_at||a.created_at).valueOf()||0,tb=new Date(b.scheduled_at||b.created_at).valueOf()||0;return (group==='upcoming'?ta-tb:tb-ta)||a.id.localeCompare(b.id);});
}
export function setupPostList({renderCard,getState,show,api,safe,msg,reload,when}){
 const root=document.querySelector('#post-list');let posts=[],group='upcoming',page=1,size=10;
 root.innerHTML='<article class="post-browser"><h2>投稿一覧</h2><div class="post-filter-tabs" role="group" aria-label="投稿の状態"></div><div class="post-list-filters"><label>投稿日（日本時間）<input id="post-filter-date" type="date"></label><label>本文・テーマを検索<input id="post-filter-query" type="search" placeholder="キーワードで絞り込み"></label><label>1ページの件数<select id="post-page-size"><option>10</option><option>20</option><option>50</option></select></label><button id="post-filter-clear" type="button">絞り込みを解除</button></div><p id="post-list-summary" aria-live="polite"></p><p class="post-meta">投稿予定には未来の下書きも含まれます。下書きは承認後に予約されます。取得済みの最新300件までを表示します。</p></article><div id="post-list-cards"></div><div class="actions post-pagination"><button id="post-page-prev" type="button">前へ</button><span id="post-page-label" aria-live="polite"></span><button id="post-page-next" type="button">次へ</button></div>';
 const $=s=>root.querySelector(s),tabs=$('.post-filter-tabs');
 const bulk=setupBulkDraftTrash({root,api,safe,msg,reload,getState,redraw:()=>draw(),when});
 const jump=document.createElement('button');jump.type='button';jump.textContent='投稿一覧へ';document.querySelector('#workspace > .actions').append(jump);jump.onclick=()=>{show('posts');root.scrollIntoView({behavior:'smooth',block:'start'});};
 function draw(){
  tabs.replaceChildren();for(const [key,label] of Object.entries(groups)){const b=document.createElement('button');b.type='button';b.textContent=label+'（'+selectPosts(posts,{group:key}).length+'）';b.setAttribute('aria-pressed',String(group===key));b.onclick=()=>{group=key;page=1;bulk.clear();draw();};tabs.append(b);}
  const matches=selectPosts(posts,{group,date:$('#post-filter-date').value,query:$('#post-filter-query').value}),pages=Math.max(1,Math.ceil(matches.length/size));page=Math.min(page,pages);
  $('#post-list-summary').textContent=groups[group]+'：'+matches.length+'件'+(matches.length?' ／ '+((page-1)*size+1)+'〜'+Math.min(page*size,matches.length)+'件を表示':'');
  const cards=$('#post-list-cards');cards.replaceChildren();const pagePosts=matches.slice((page-1)*size,page*size),canBulk=group==='draft'&&getState()?.member.role==='admin';
  for(const p of pagePosts){
   const a=renderCard(p),body=a.querySelector('.post-body'),excerpt=document.createElement('p'),details=document.createElement('details'),summary=document.createElement('summary'),actions=document.createElement('div');
   a.classList.add('compact-post');excerpt.className='post-excerpt';excerpt.textContent=body.textContent;summary.textContent='全文・操作を開く';actions.className='actions';for(const b of [...a.children].filter(el=>el.tagName==='BUTTON'))actions.append(b);details.append(summary,body);if(actions.children.length)details.append(actions);a.append(excerpt,details);if(canBulk)a.prepend(bulk.checkbox(p));cards.append(a);
  }
  if(!matches.length){const empty=document.createElement('p');empty.className='post-empty';empty.textContent='この条件に一致する投稿はありません。';cards.append(empty);}
  $('#post-page-label').textContent=page+' / '+pages+'ページ';$('#post-page-prev').disabled=page===1;$('#post-page-next').disabled=page===pages;
  bulk.render(matches,pagePosts,canBulk);
 }
 for(const id of ['#post-filter-date','#post-filter-query'])$(id).addEventListener('input',()=>{page=1;bulk.clear();draw();});
 $('#post-page-size').onchange=()=>{size=Number($('#post-page-size').value);page=1;draw();};
 $('#post-filter-clear').onclick=()=>{$('#post-filter-date').value='';$('#post-filter-query').value='';page=1;bulk.clear();draw();};
 $('#post-page-prev').onclick=()=>{page--;draw();root.scrollIntoView({block:'start'});};$('#post-page-next').onclick=()=>{page++;draw();root.scrollIntoView({block:'start'});};
 return {render(){posts=getState()?.posts||[];bulk.prune(posts);draw();},reset(){posts=[];group='upcoming';page=1;size=10;bulk.reset();$('#post-filter-date').value='';$('#post-filter-query').value='';$('#post-page-size').value='10';draw();}};
}
