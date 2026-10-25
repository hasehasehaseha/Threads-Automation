import {uuid,validateGenerationDate} from './generation.js';
export function validateApprovalPreview(data){
 if(data.mode==='count'){
  if(!Number.isInteger(data.count)||data.count<1||data.count>100)throw new Error('件数は1〜100件で指定してください。');
  return {p_limit:data.count,p_end:null};
 }
 if(data.mode==='date')return {p_limit:100,p_end:validateGenerationDate(data.end_date)};
 throw new Error('件数指定または日付指定を選んでください。');
}
export function validateBulkApproval(data){
 if(!uuid.test(data.request_id)||!Array.isArray(data.posts)||data.posts.length<1||data.posts.length>100||data.posts.some(p=>!p||!uuid.test(p.id)||!Number.isInteger(p.version)||p.version<1)||new Set(data.posts.map(p=>p.id)).size!==data.posts.length)throw new Error('承認対象は重複のない1〜100件で指定してください。');
 return {p_request:data.request_id,p_ids:data.posts.map(p=>p.id),p_versions:data.posts.map(p=>p.version)};
}
