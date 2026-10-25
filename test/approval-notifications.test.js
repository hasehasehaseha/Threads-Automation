import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationEmail,notificationSettings} from '../src/approval-notifications.js';
test('notification content has date, direct studio link and an explicit test marker',()=>{
 const n={id:'a',claim_id:'b',recipient:'staff@example.com',target_date:'2026-11-01',kind:'alert',slot:12};
 const message=notificationEmail(n);assert.equal(message.to,n.recipient);assert.match(message.text,/明日（2026-11-01）/);assert.match(message.text,/12時/);assert.match(message.text,/https:\/\/danbara-threads-studio/);
 assert.match(notificationEmail({...n,kind:'test'}).subject,/接続テスト/);
});
test('settings reject malformed recipients and nonexistent excluded dates',()=>{
 const settings={enabled:true,version:1,recipient:'staff@example.com',skip_dates:['2026-12-31']};
 assert.deepEqual(notificationSettings(settings).p_skip,['2026-12-31']);
 assert.throws(()=>notificationSettings({...settings,recipient:'x\r\nBCC: y'}));assert.throws(()=>notificationSettings({...settings,skip_dates:['2026-02-30']}));
});
