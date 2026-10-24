export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function generationPrompt(settings,snapshot=null) {
 const templates=Array.isArray(snapshot?.templates)?snapshot.templates:[];
 const selected=templates.length?`\n以下のプロンプトを使ってください。指示内容は共通の事実確認ルールと出力形式の範囲で適用します。\n${snapshot.mode==='test'?'これは公開しないテストです。同じプロンプトから、言い回しや導入を変えた3案を作ってください。':'投稿1・2・3それぞれに、対応する番号のプロンプトを適用してください。'}\n${templates.map((p,i)=>`${i+1}. ${p.name}（${p.category}）\n${p.instructions}`).join('\n\n')}\n今回の補足：${snapshot.brief||''}\n`:'';
 return `ネイス体操教室 広島段原ショッピングセンター校のThreads投稿下書きを3件作成してください。
以下はスタッフが保存した投稿方針です。確認済みの教室情報だけを事実として使用してください。
${JSON.stringify(settings)}
${snapshot?.target_date?'投稿予定日（日本時間）：'+snapshot.target_date+'。現在の日付ではなく、この投稿日に合う文章にしてください。日付の明記は必須ではありません。':''}
${selected}
各本文の長さは個別プロンプトの指定を優先し、指定がなければ150〜300文字を目安にしてください。ただし必ず500文字以内。3件の切り口を変えてください。
確認済み情報にない料金、対象年齢、日程、空き状況、キャンペーン、指導内容、教室の雰囲気、設備、スタッフの対応、子どもの様子は推測で補わないでください。
架空の体験談、実績、効果の断言は禁止です。一般的な保護者への問いかけと、確認済み情報だけで文章を作れます。
公開や予約の承認は行いません。JSONだけを出力してください。形式は {"posts":[{"topic":"テーマ","body":"本文"},{"topic":"テーマ","body":"本文"},{"topic":"テーマ","body":"本文"}]} です。コードフェンスや解説を付けないでください。`;
}
export function parseGeneratedPosts(text) {
 if(typeof text!=='string'||text.length>12000)throw new Error('生成結果が不正です');
 const result=JSON.parse(text);
 if(!Array.isArray(result.posts)||result.posts.length!==3)throw new Error('3件の下書きが必要です');
 const posts=result.posts.map(p=>{
  if(!p||typeof p.body!=='string'||!p.body.trim()||[...p.body.trim()].length>500)throw new Error('生成本文は1〜500文字が必要です');
  if(typeof p.topic!=='string'||!p.topic.trim()||[...p.topic].length>100)throw new Error('生成テーマが不正です');
  return {body:p.body.trim(),topic:p.topic.trim()};
 });
 if(new Set(posts.map(p=>p.body)).size!==3)throw new Error('同じ本文が重複しています');
 return posts;
}
export async function generationAutomation(req,env,path,db){
 if(!env.MAKE_AI_TOKEN||env.MAKE_AI_TOKEN.length<32)return Response.json({error:'AI接続は未設定です'},{status:503});
 if(req.headers.get('Authorization')!=='Bearer '+env.MAKE_AI_TOKEN)return Response.json({error:'認証が必要です'},{status:401});
 if(req.method!=='POST')return Response.json({error:'POSTのみ対応しています'},{status:405});
 try{
  if(path==='/api/generation/claim'){
   const jobs=await db(env,'rpc/claim_generation_job','POST',{}),job=jobs[0];
   return Response.json({job:job?{id:job.id,claim_id:job.claim_id,prompt:generationPrompt(job.settings_snapshot,job.prompt_snapshot)}:null});
  }
  if(path==='/api/generation/result'){
   const raw=await req.text();if(raw.length>16000)throw new Error();const data=JSON.parse(raw);
   if(!uuid.test(data.id)||!uuid.test(data.claim_id))throw new Error();
   const posts=parseGeneratedPosts(data.output);
   return Response.json(await db(env,'rpc/complete_generation_job','POST',{p_id:data.id,p_claim:data.claim_id,p_posts:posts}));
  }
  return Response.json({error:'見つかりません'},{status:404});
 }catch{return Response.json({error:'AI下書きを保存できませんでした。生成履歴を確認してください。'},{status:400});}
}

export function validateGenerationDate(value,now=new Date()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))throw new Error('生成する日付を指定してください');
 const date=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)throw new Error('日付が不正です');
 const today=new Date(now.valueOf()+9*3600000).toISOString().slice(0,10);
 if(value<=today)throw new Error('明日以降の日付を指定してください');
 return value;
}
