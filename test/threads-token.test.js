import test from 'node:test';import assert from 'node:assert/strict';
import {encryptToken,decryptToken,threadsEnvironment,publicTokenStatus,initializeToken,refreshThreadsToken} from '../src/threads-token.js';
const secret='ab'.repeat(32),oldToken='old-token-not-for-browser-123',newToken='new-token-not-for-browser-456';
const env={TOKEN_AUTO_REFRESH_ENABLED:'true',THREADS_TOKEN_ENCRYPTION_KEY:secret,THREADS_ACCESS_TOKEN:oldToken};
test('token encryption is randomized and detects tampering or wrong keys',async()=>{
 const a=await encryptToken(oldToken,secret),b=await encryptToken(oldToken,secret);
 assert.notEqual(a,b);assert.ok(!a.includes(oldToken));assert.equal(await decryptToken(a,secret),oldToken);
 await assert.rejects(decryptToken(a,'cd'.repeat(32)));
 const changed=JSON.parse(a);changed.iv=btoa('123456789012');await assert.rejects(decryptToken(JSON.stringify(changed),secret));
});
test('all Threads operations select the stored token and never silently fall back on storage errors',async()=>{
 const row={encrypted_token:await encryptToken(newToken,secret),expires_at:new Date(Date.now()+86400000).toISOString(),status:'healthy'};
 assert.equal((await threadsEnvironment(env,async()=>[row])).THREADS_ACCESS_TOKEN,newToken);
 assert.equal(env.THREADS_ACCESS_TOKEN,oldToken);
 await assert.rejects(threadsEnvironment(env,async()=>{throw new Error('db offline');}));
 await assert.rejects(threadsEnvironment(env,async()=>[{...row,status:'reconnect'}]));
 await assert.rejects(threadsEnvironment(env,async()=>[{...row,expires_at:'2000-01-01T00:00:00Z'}]));
});
test('public status has an allowlist and never includes encrypted or plaintext credentials',()=>{
 const result=JSON.stringify(publicTokenStatus({encrypted_token:'CIPHER',access_token:'SECRET',claim_id:'CLAIM',status:'healthy'},true));
 for(const value of ['CIPHER','SECRET','CLAIM','encrypted_token','access_token'])assert.ok(!result.includes(value));
});
test('initialization validates the exact classroom account before storing encrypted credentials',async t=>{
 let inserted;
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'40462225730042818',username:'neis_hiroshima'}));
 await initializeToken(env,async(e,path,method,body)=>{if(method==='POST'){inserted=body;return [body];}return inserted?[inserted]:[];});
 assert.equal(await decryptToken(inserted.encrypted_token,secret),oldToken);assert.ok(!JSON.stringify(inserted).includes(oldToken));
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'another',username:'neis_hiroshima'}));
 await assert.rejects(initializeToken(env,async()=>[]),/一致しません/);
});
test('refresh validates identity, saves encrypted replacement and uses Meta expiry',async t=>{
 const row={claim_id:'claim',encrypted_token:await encryptToken(oldToken,secret)};let saved,requests=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests++;assert.equal(options.redirect,'manual');
  if(requests===1){const parsed=new URL(url);assert.equal(parsed.hostname,'graph.threads.com');assert.equal(parsed.searchParams.get('grant_type'),'th_refresh_token');assert.equal(parsed.searchParams.get('access_token'),oldToken);return Response.json({access_token:newToken,expires_in:5184000});}
  assert.equal(options.headers.Authorization,'Bearer '+newToken);return Response.json({id:'40462225730042818',username:'neis_hiroshima'});
 });
 const result=await refreshThreadsToken(env,async(e,path,m,body)=>{if(path.endsWith('claim_threads_refresh'))return [row];saved=body;return true;});
 assert.equal(result.state,'refreshed');assert.equal(await decryptToken(saved.p_encrypted,secret),newToken);assert.ok(Date.parse(saved.p_expires)>Date.now()+59*86400000);
 assert.ok(!JSON.stringify(result).includes(newToken));
});
test('refresh failure preserves the current token and stores only safe errors',async t=>{
 const row={claim_id:'claim',encrypted_token:await encryptToken(oldToken,secret)};let saved;
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:{code:190,message:'secret-url='+oldToken}},{status:401}));
 const result=await refreshThreadsToken(env,async(e,path,m,body)=>{if(path.endsWith('claim_threads_refresh'))return [row];saved=body;return true;});
 assert.equal(result.state,'error');assert.equal(saved.p_reconnect,true);assert.ok(!saved.p_encrypted);assert.ok(!JSON.stringify(saved).includes(oldToken));assert.match(saved.p_error,/190/);
});
test('duplicate or not-due refresh does not call Meta; unexpected responses cannot replace the token',async t=>{
 let calls=0,writes=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({access_token:'invalid',expires_in:-1});});
 assert.deepEqual(await refreshThreadsToken(env,async()=>[]),{state:'not_due'});assert.equal(calls,0);
 const row={claim_id:'claim',encrypted_token:await encryptToken(oldToken,secret)};
 const result=await refreshThreadsToken(env,async(e,path,m,body)=>{if(path.endsWith('claim_threads_refresh'))return [row];assert.ok(!body.p_encrypted);writes++;return true;});
 assert.equal(result.state,'error');assert.equal(calls,1);assert.equal(writes,1);
});
test('a still-valid token remains usable when Meta rejects refreshing it too early',async t=>{
 const row={claim_id:'claim',encrypted_token:await encryptToken(oldToken,secret)};let calls=0,saved;
 t.mock.method(globalThis,'fetch',async()=>++calls===1?Response.json({error:{code:190}},{status:400}):Response.json({id:'40462225730042818',username:'neis_hiroshima'}));
 await refreshThreadsToken(env,async(e,path,m,body)=>{if(path.endsWith('claim_threads_refresh'))return [row];saved=body;return true;});
 assert.equal(saved.p_reconnect,false);assert.ok(!saved.p_encrypted);assert.equal(calls,2);
});
