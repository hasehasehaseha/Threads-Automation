import test from 'node:test';import assert from 'node:assert/strict';
import {parseMetrics,collectMetrics} from '../src/metrics.js';
test('missing insights stay null, zero stays zero',()=>{const v=parseMetrics({data:[{name:'views',values:[{value:0}]}]});assert.equal(v.views,0);assert.equal(v.likes,null);});
test('invalid insights are not saved as zero',()=>{for(const value of [-1,'5',null])assert.throws(()=>parseMetrics({data:[{name:'views',values:[{value}]}]}));assert.throws(()=>parseMetrics({data:[]}));});
test('failed metrics do not overwrite history and recently collected posts are skipped',async t=>{
 let writes=0,calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:401});});
 const db=async(e,path,method)=>{if(method==='POST'){writes++;return;}if(path.startsWith('posts?'))return [{id:'a',meta_post_id:'1'},{id:'b',meta_post_id:'2'}];return [{post_id:'a'}];};
 assert.deepEqual(await collectMetrics({THREADS_ACCESS_TOKEN:'secret'},db),{saved:0,failed:1,skipped:1,total:2});assert.equal(writes,0);assert.equal(calls,1);
});
