const ACCESS='__Secure-danbara-access',REFRESH='__Secure-danbara-refresh',AGE=30*86400;
export function sessionCookies(req){
 const found={};for(const part of (req.headers.get('Cookie')||'').split(';')){const i=part.indexOf('=');if(i<0)continue;const key=part.slice(0,i).trim();if(key!==ACCESS&&key!==REFRESH)continue;try{found[key]=decodeURIComponent(part.slice(i+1).trim());}catch{}}
 return {access:found[ACCESS],refresh:found[REFRESH]};
}
function response(data,status=200,session,clear=false){
 const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 if(session||clear)for(const [name,value,path] of [[ACCESS,session?.access_token,'/api'],[REFRESH,session?.refresh_token,'/api/auth']])headers.append('Set-Cookie',name+'='+encodeURIComponent(value||'')+'; Path='+path+'; Max-Age='+(clear?0:AGE)+'; HttpOnly; Secure; SameSite=Strict');
 return new Response(JSON.stringify(data),{status,headers});
}
const transient=r=>r.status===429||r.status>=500;
async function auth(env,path,method='GET',body,access){const r=await fetch(env.SUPABASE_URL+'/auth/v1/'+path,{method,headers:{apikey:env.SUPABASE_ANON_KEY,...(body?{'Content-Type':'application/json'}:{}),...(access?{Authorization:'Bearer '+access}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000),redirect:'manual'});if(r.status>=300&&r.status<400)throw new Error('unexpected auth redirect');return r;}
async function staff(env,access,db){
 const r=await auth(env,'user','GET',null,access);if(transient(r))throw new Error('temporary');if(!r.ok)return null;const user=await r.json();if(typeof user.id!=='string')return null;
 return (await db(env,'members?user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true&select=user_id,role'))[0]||null;
}
function nearExpiry(jwt){try{const part=jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return Number(JSON.parse(atob(part)).exp)*1000<Date.now()+120000;}catch{return true;}}
async function revoke(env,access){if(access)try{await auth(env,'logout?scope=local','POST',null,access);}catch{}}
export async function staffSession(req,env,path,db){
 if(req.method!=='POST')return response({error:'POSTのみ対応しています'},405);
 const cookies=sessionCookies(req);
 try{
  if(path==='/api/auth/logout'){
   let access=cookies.access;
   if((!access||nearExpiry(access))&&cookies.refresh)try{const r=await auth(env,'token?grant_type=refresh_token','POST',{refresh_token:cookies.refresh});if(r.ok)access=(await r.json()).access_token;}catch{}
   await revoke(env,access);return response({authenticated:false},200,null,true);
  }
  if(path==='/api/auth/login'){
   const raw=await req.text();if(raw.length>3000)return response({error:'入力内容が大きすぎます'},413);let data;try{data=JSON.parse(raw);}catch{return response({error:'入力形式が不正です'},400);}
   if(typeof data.email!=='string'||typeof data.password!=='string'||!data.email||!data.password)return response({error:'メールアドレスとパスワードを入力してください。'},400);
   const r=await auth(env,'token?grant_type=password','POST',{email:data.email,password:data.password});
   if(transient(r))throw new Error('temporary');if(!r.ok)return response({error:'ログインできませんでした。入力内容を確認してください。'},401);
   const session=await r.json();if(!session.access_token||!session.refresh_token)throw new Error('invalid session');
   if(!await staff(env,session.access_token,db)){await revoke(env,session.access_token);return response({error:'スタッフ登録が必要です。'},403,null,true);}
   return response({authenticated:true},200,session);
  }
  if(path==='/api/auth/session'){
   if(cookies.access){const m=await staff(env,cookies.access,db);if(m&&(!nearExpiry(cookies.access)||!cookies.refresh))return response({authenticated:true});if(m===null&& !cookies.refresh)return response({authenticated:false},200,null,true);}
   if(!cookies.refresh)return response({authenticated:false},200,null,true);
   const r=await auth(env,'token?grant_type=refresh_token','POST',{refresh_token:cookies.refresh});
   if(transient(r))throw new Error('temporary');if(!r.ok)return response({authenticated:false},200,null,true);
   const session=await r.json();if(!session.access_token||!session.refresh_token)throw new Error('invalid session');
   if(!await staff(env,session.access_token,db)){await revoke(env,session.access_token);return response({authenticated:false},200,null,true);}
   return response({authenticated:true},200,session);
  }
  return response({error:'見つかりません'},404);
 }catch{return response({error:'認証サーバーに接続できません。時間をおいてもう一度お試しください。'},503);}
}
