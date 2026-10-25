import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPosts} from '../public/post-list.js';
test('post list uses Japan calendar dates and separates published posts from future drafts',()=>{
 const posts=[{id:'a',status:'draft',body:'親子の体操',scheduled_at:'2090-01-01T15:00:00Z'},{id:'b',status:'published',body:'公開済み',scheduled_at:'2090-01-01T14:59:00Z'},{id:'c',status:'needs_review',body:'確認用',scheduled_at:null}];
 assert.deepEqual(selectPosts(posts,{group:'upcoming',date:'2090-01-02'}).map(p=>p.id),['a']);
 assert.deepEqual(selectPosts(posts,{group:'published',date:'2090-01-01'}).map(p=>p.id),['b']);
 assert.deepEqual(selectPosts(posts,{group:'attention'}).map(p=>p.id),['c']);
 assert.deepEqual(selectPosts(posts,{group:'all',query:'親子'}).map(p=>p.id),['a']);
});
