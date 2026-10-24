export function validateTemplate(data){
 const name=String(data.name||'').trim(),category=String(data.category||'').trim(),instructions=String(data.instructions||'').trim();
 if(!name||[...name].length>100||!category||[...category].length>60||!instructions||instructions.length>6000)throw new Error('名前・分類・プロンプトを入力してください（プロンプトは6,000文字以内）');
 return {name,category,instructions,active:data.active!==false};
}
export function validateTest(data){
 const template=validateTemplate(data),brief=String(data.brief||'').trim();
 if(brief.length>2000)throw new Error('今回試したい内容は2,000文字以内で入力してください');
 return {mode:'test',count:1,delivery:'direct',templates:[template],brief};
}
