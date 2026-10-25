import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('login works in Cloudflare runtime and returns two secure cookies without following redirects',async()=>{
 const bundle=await build({stdin:{contents:"import {staffSession} from './src/staff-session.js';export default {fetch(req){return staffSession(req,{SUPABASE_URL:'https://auth-fixture.example',SUPABASE_ANON_KEY:'fixture'},'/api/auth/login',async()=>[{user_id:'fixture',role:'admin'}]);}};",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false});
 let calls=0,redirect=false;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-22',outboundService:async req=>{calls++;if(redirect)return new Response(null,{status:302,headers:{Location:'https://do-not-follow.example'}});return req.url.includes('grant_type=password')?Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh'}):Response.json({id:'fixture'});}}));
 try{
  const init={method:'POST',body:JSON.stringify({email:'fixture@example.com',password:'fixture-only'})};
  let r=await mf.dispatchFetch('https://studio.example/api/auth/login',init);assert.equal(r.status,200);assert.deepEqual(await r.json(),{authenticated:true});assert.equal(calls,2);assert.equal(r.headers.getSetCookie().length,2);assert.ok(r.headers.getSetCookie().every(c=>c.includes('HttpOnly')&&c.includes('Secure')));
  redirect=true;r=await mf.dispatchFetch('https://studio.example/api/auth/login',init);assert.equal(r.status,503);assert.equal(calls,3);assert.equal(r.headers.getSetCookie().length,0);
 }finally{await mf.dispose();}
});
