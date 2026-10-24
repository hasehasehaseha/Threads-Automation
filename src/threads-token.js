const ID='neis_hiroshima',AAD=new TextEncoder().encode('danbara:threads:neis_hiroshima:v1');
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const unbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export function tokenManagementReady(env){return env.TOKEN_AUTO_REFRESH_ENABLED==='true'&&/^[a-f0-9]{64}$/i.test(env.THREADS_TOKEN_ENCRYPTION_KEY||'');}
async function key(secret){
 if(!/^[a-f0-9]{64}$/i.test(secret||''))throw new Error('トークン暗号化設定が必要です');
 return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g),x=>parseInt(x,16)),'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptToken(token,secret){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},await key(secret),new TextEncoder().encode(token));
 return JSON.stringify({v:1,iv:base64(iv),data:base64(new Uint8Array(cipher))});
}
export async function decryptToken(value,secret){
 try{
  const data=JSON.parse(value);if(data.v!==1)throw new Error();
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(data.iv),additionalData:AAD},await key(secret),unbase64(data.data)));
 }catch{throw new Error('Threads接続情報を復号できません。暗号化設定を確認してください');}
}
async function record(env,db){return (await db(env,'threads_credentials?id=eq.'+ID+'&limit=1'))[0]||null;}
export async function threadsEnvironment(env,db){
 if(env.TOKEN_AUTO_REFRESH_ENABLED!=='true')return env;
 if(!tokenManagementReady(env))throw new Error('Threads自動更新の暗号化設定が必要です');
 const row=await record(env,db);
 if(!row)return env; // Bootstrap only; never fall back when a stored token exists.
 if(row.status==='reconnect'||(row.expires_at&&Date.parse(row.expires_at)<=Date.now()))throw new Error('Threadsの再接続が必要です。トークンの期限・権限を確認してください');
 return {...env,THREADS_ACCESS_TOKEN:await decryptToken(row.encrypted_token,env.THREADS_TOKEN_ENCRYPTION_KEY)};
}
export function publicTokenStatus(row,enabled){
 return {enabled,initialized:!!row,status:row?.status||'uninitialized',expiresAt:row?.expires_at||null,refreshedAt:row?.refreshed_at||null,nextAttemptAt:row?.next_attempt_at||null,lastAttemptAt:row?.last_attempt_at||null,lastError:row?.last_error||null};
}
export async function tokenStatus(env,db){
 if(!tokenManagementReady(env))return publicTokenStatus(null,false);
 return publicTokenStatus(await record(env,db),true);
}
class TokenError extends Error{
 constructor(message,reconnect=false){super(message);this.reconnect=reconnect;}
}
async function metaJSON(url,token){
 let response;
 try{response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new TokenError('Metaとの通信に失敗しました。次回再確認します');}
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  const code=Number.isInteger(data.error?.code)?data.error.code:null;
  // Raw Meta error messages/URLs may contain credentials. Store numeric codes only.
  throw new TokenError('Meta更新エラー HTTP '+response.status+' / code '+(code??'unknown'),code===190);
 }
 return data;
}
async function verify(token){
 const profile=await metaJSON('https://graph.threads.net/v1.0/me?fields=id,username',token);
 if(profile.id!=='40462225730042818'||profile.username!==ID)throw new TokenError('Threadsの接続先が教室アカウントと一致しません',true);
}
export async function initializeToken(env,db){
 if(!tokenManagementReady(env))throw new Error('自動更新の保存設定がまだ完了していません');
 if(await record(env,db))return tokenStatus(env,db);
 if(!env.THREADS_ACCESS_TOKEN)throw new Error('初期トークンが未設定です');
 await verify(env.THREADS_ACCESS_TOKEN);
 const encrypted=await encryptToken(env.THREADS_ACCESS_TOKEN,env.THREADS_TOKEN_ENCRYPTION_KEY);
 // A duplicate initialization cannot overwrite an already refreshed credential.
 await db(env,'threads_credentials?on_conflict=id','POST',{id:ID,encrypted_token:encrypted});
 return tokenStatus(env,db);
}
export async function refreshThreadsToken(env,db){
 if(!tokenManagementReady(env))return {state:'disabled'};
 const rows=await db(env,'rpc/claim_threads_refresh','POST',{}),row=rows[0];
 if(!row)return {state:'not_due'};
 let oldToken;
 try{
  oldToken=await decryptToken(row.encrypted_token,env.THREADS_TOKEN_ENCRYPTION_KEY);
  // Meta explicitly requires the token as a query parameter on this endpoint.
  // This server-only URL is never returned, logged, or stored.
  const url=new URL('https://graph.threads.com/refresh_access_token');
  url.searchParams.set('grant_type','th_refresh_token');url.searchParams.set('access_token',oldToken);
  const data=await metaJSON(url.toString(),oldToken);
  if(typeof data.access_token!=='string'||data.access_token.length<20||!Number.isSafeInteger(data.expires_in)||data.expires_in<86400||data.expires_in>90*86400)throw new TokenError('Metaの更新応答を確認できませんでした');
  await verify(data.access_token);
  const expires=new Date(Date.now()+data.expires_in*1000).toISOString();
  const saved=await db(env,'rpc/complete_threads_refresh','POST',{p_claim:row.claim_id,p_encrypted:await encryptToken(data.access_token,env.THREADS_TOKEN_ENCRYPTION_KEY),p_expires:expires});
  if(saved!==true)throw new TokenError('更新結果の保存が競合しました。接続状態を確認してください');
  return {state:'refreshed',expiresAt:expires};
 }catch(error){
  const message=error instanceof TokenError?error.message:'トークン更新を完了できません。保存設定を確認してください';
  let reconnect=error instanceof TokenError&&error.reconnect;
  // Refresh rejection alone does not prove the current token has expired.
  if(reconnect&&oldToken){try{await verify(oldToken);reconnect=false;}catch{}}
  await db(env,'rpc/complete_threads_refresh','POST',{p_claim:row.claim_id,p_error:message,p_reconnect:reconnect});
  return {state:'error',error:message};
 }
}
