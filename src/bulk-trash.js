import {validateBulkApproval} from './bulk-approval.js';
export function validateBulkTrash(data){
 try{return validateBulkApproval(data);}catch{throw new Error('移動対象は重複のない1〜100件の下書きで指定してください。');}
}
