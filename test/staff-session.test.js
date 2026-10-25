import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/worker.js';import {staffSession} from '../src/staff-session.js';
const env={SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private'},jwt=exp=>'e30.'+btoa(JSON.stringify({exp}))+'.signature',valid=jwt(Math.floor(Date.now()/1000)+3600),expired=jwt(1);
const request=(path,data={},cookie='',origin='https://studio.example')=>new Request('https://studio.example/api/auth/'+path,{method:'POST',headers:{Origin:origin,Cookie:cookie},body:JSON.stringify(data)});
const db=async()=>[{user_id:'staff',role:'admin'}];
test('staff login sets HttpOnly persistent cookies and never returns credentials in JSON',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(options.redirect,'manual');if(url.includes('grant_type=password')){assert.deepEqual(JSON.parse(options.body),{email:'staff@example.com',password:'example-password'});return Response.json({access_token:valid,refresh_token:'refresh-private'});}return Response.json({id:'staff'});});
 const r=await staffSession(request('login',{email:'staff@example.com',password:'example-password'}),env,'/api/auth/login',db);assert.equal(r.status,200);assert.deepEqual(await r.json(),{authenticated:true});
 const cookies=r.headers.getSetCookie();assert.equal(cookies.length,2);for(const c of cookies){assert.match(c,/HttpOnly; Secure; SameSite=Strict/);assert.match(c,/Max-Age=2592000/);}assert.match(cookies[1],/Path=\/api\/auth/);
});
test('reload keeps a verified existing session and expired access rotates both cookies',async t=>{
 let refreshes=0;t.mock.method(globalThis,'fetch',async(url,options)=>{if(url.includes('grant_type=refresh_token')){refreshes++;assert.deepEqual(JSON.parse(options.body),{refresh_token:'old-refresh'});return Response.json({access_token:valid,refresh_token:'new-refresh'});}return options.headers.Authorization==='Bearer '+valid?Response.json({id:'staff'}):Response.json({}, {status:401});});
 let r=await staffSession(request('session',{},'__Secure-danbara-access='+valid+'; __Secure-danbara-refresh=old-refresh'),env,'/api/auth/session',db);assert.equal((await r.json()).authenticated,true);assert.equal(refreshes,0);
 r=await staffSession(request('session',{},'__Secure-danbara-access='+expired+'; __Secure-danbara-refresh=old-refresh'),env,'/api/auth/session',db);assert.equal((await r.json()).authenticated,true);assert.equal(refreshes,1);assert.ok(r.headers.getSetCookie().some(c=>c.includes('new-refresh')));
});
test('revoked refresh clears cookies, temporary outages keep them for later recovery',async t=>{
 let status=400;t.mock.method(globalThis,'fetch',async()=>Response.json({}, {status}));
 let r=await staffSession(request('session',{},'__Secure-danbara-refresh=bad'),env,'/api/auth/session',db);assert.equal((await r.json()).authenticated,false);assert.equal(r.headers.getSetCookie().length,2);assert.match(r.headers.getSetCookie()[0],/Max-Age=0/);
 status=503;r=await staffSession(request('session',{},'__Secure-danbara-refresh=bad'),env,'/api/auth/session',db);assert.equal(r.status,503);assert.equal(r.headers.getSetCookie().length,0);
});
test('inactive staff cannot save or restore a session',async t=>{
 t.mock.method(globalThis,'fetch',async url=>url.includes('token?')?Response.json({access_token:valid,refresh_token:'r'}):Response.json({id:'staff'}));
 const r=await staffSession(request('login',{email:'staff@example.com',password:'example'}),env,'/api/auth/login',async()=>[]);assert.equal(r.status,403);assert.ok(r.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));
});
test('logout revokes only the current device session and clears cookies even on network errors',async t=>{
 let url='';t.mock.method(globalThis,'fetch',async u=>{url=u;throw new Error('offline');});
 const r=await staffSession(request('logout',{},'__Secure-danbara-access='+valid),env,'/api/auth/logout',db);assert.match(url,/logout\?scope=local/);assert.equal(r.status,200);assert.ok(r.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));
});
test('cookie sessions cannot bypass origin or staff membership checks',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async url=>{calls++;return url.endsWith('/auth/v1/user')?Response.json({id:'staff'}):Response.json([]);});
 const r=await worker.fetch(request('logout',{},'__Secure-danbara-access='+valid,'https://evil.example'),env);assert.equal(r.status,403);assert.equal(calls,0);
 const state=await worker.fetch(new Request('https://studio.example/api/state',{headers:{Cookie:'__Secure-danbara-access='+valid}}),env);assert.equal(state.status,401);assert.equal(calls,2);
});
