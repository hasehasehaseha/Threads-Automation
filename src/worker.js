const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function validatePost(data){
 if(typeof data.body!=='string'||!data.body.trim()||[...data.body].length>500)throw new Error('投稿文は1〜500文字で入力してください');
 if(data.planned&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.planned))throw new Error('投稿日時が不正です');
 const at=data.planned?new Date(data.planned+':00+09:00'):null;
 if(at&&Number.isNaN(at.valueOf()))throw new Error('投稿日時が不正です');
 return {p_body:data.body.trim(),p_topic:String(data.topic||'').slice(0,100),p_at:at?.toISOString()||null,p_settings:data.settings_id||null};
}
export function isReady(env){return !!(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY&&env.SUPABASE_SERVICE_ROLE_KEY);}
async function db(env,path,method='GET',body){
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw new Error('保存できませんでした。権限、日時の重複、他の人による変更を確認して再読み込みしてください。');
 return r.status===204?null:r.json();
}
async function member(req,env){
 const token=req.headers.get('Authorization');if(!token?.startsWith('Bearer '))return null;
 const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:token}});
 if(!r.ok)return null;const user=await r.json();
 const rows=await db(env,'members?user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true&select=user_id,role');
 return rows[0]||null;
}
export default {async fetch(req,env){
 const url=new URL(req.url),path=url.pathname;
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(path==='/api/config'&&req.method==='GET')return json({ready:isReady(env),supabaseUrl:env.SUPABASE_URL||'',anonKey:env.SUPABASE_ANON_KEY||'',automationEnabled:env.AUTOMATION_ENABLED==='true',handle:'neis_hiroshima'});
 if(!isReady(env))return json({error:'Supabaseの接続設定がまだ完了していません。'},503);
 if(req.method!=='GET'&&req.headers.get('Origin')!==url.origin)return json({error:'同じ管理画面から操作してください。'},403);
 try{
 const m=await member(req,env);if(!m)return json({error:'ログインまたはスタッフ登録が必要です。'},401);
 if(path==='/api/state'&&req.method==='GET'){
 const [posts,settings,metrics]=await Promise.all([db(env,'posts?order=created_at.desc&limit=300'),db(env,'editorial_settings?order=id.desc&limit=1'),db(env,'metric_snapshots?order=captured_at.desc&limit=300')]);
 return json({member:m,posts,settings:settings[0]||null,metrics});
 }
 if(req.method!=='POST')return json({error:'見つかりません'},404);
 const raw=await req.text();if(raw.length>30000)return json({error:'入力内容が大きすぎます'},413);const data=JSON.parse(raw);
 if(path==='/api/settings'){
 if(m.role!=='admin')return json({error:'投稿方針の変更は管理者のみ可能です。'},403);
 if(!data||typeof data!=='object'||Array.isArray(data))return json({error:'設定形式が不正です'},400);
 return json(await db(env,'editorial_settings','POST',{content:data,created_by:m.user_id}));
 }
 if(path==='/api/posts'){
 const action=data.action;if(!['create','edit','approve','cancel'].includes(action))return json({error:'操作が不正です'},400);
 if(action!=='create'&&(!/^[0-9a-f-]{36}$/i.test(data.id)||!Number.isInteger(data.version)))return json({error:'投稿IDまたは版番号が不正です'},400);
 if(['approve','cancel'].includes(action)&&m.role!=='admin')return json({error:'承認・取消は管理者のみ可能です'},403);
 const args={p_actor:m.user_id,p_action:action,p_id:data.id||null,p_version:data.version||null};
 if(['create','edit'].includes(action))Object.assign(args,validatePost(data));
 return json(await db(env,'rpc/mutate_post','POST',args));
 }
 return json({error:'見つかりません'},404);
 }catch(error){return json({error:error instanceof SyntaxError?'入力形式が不正です':error.message},400);}
}};
