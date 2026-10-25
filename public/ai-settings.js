export function setupAiSettings({api,safe,msg,getState,reload}){
 const $=s=>document.querySelector(s);let dirty=false;
 $('#ai-model').onchange=()=>{dirty=true;};
 $('#ai-config-form').onsubmit=safe(async()=>{
  const s=getState();await api('ai-config',{version:s.ai.config.version,model:$('#ai-model').value});dirty=false;await reload();msg('AIモデルを保存しました。次に開始する生成から使います。');
 });
 return {reset(){dirty=false;$('#ai-usage').replaceChildren();},render(){
  const s=getState(),ai=s?.ai;$('#save-ai-model').disabled=s?.member.role!=='admin'||!ai;$('#ai-model').disabled=s?.member.role!=='admin'||!ai;
  if(!ai)return;if(!dirty)$('#ai-model').value=ai.config.model;
  const u=ai.usage,root=$('#ai-usage');root.replaceChildren();const days=new Date(Number(u.month.slice(0,4)),Number(u.month.slice(5)),0).getDate(),today=Number(new Date(Date.now()+9*3600000).toISOString().slice(8,10));
  const lines=[u.month+'（日本時間）','通常生成：概算 $'+Number(u.productionUsd).toFixed(3)+' ／ 月間目安 $20','テスト：概算 $'+Number(u.testUsd).toFixed(3)+'（通常生成と別集計）','入力 '+Number(u.inputTokens).toLocaleString()+' ／ 出力 '+Number(u.outputTokens).toLocaleString()+' トークン','通常生成の月末予測：$'+(Number(u.productionUsd)/today*days).toFixed(2)+'（今月の経過日数からの単純予測）','応答・利用量未確定の処理：'+u.unknownCalls+'件'];
  for(const line of lines){const p=document.createElement('p');p.textContent=line;root.append(p);}
 }};
}
