import {publishClaim} from './publish.js';

// Database claims serialize overlapping cron runs and the legacy Make route.
// Never retry an uncertain external write. Stale reservations are stopped by SQL.
export async function publishDue(env,db,publish=publishClaim){
 if(env.AUTOMATION_ENABLED!=='true'||!env.THREADS_ACCESS_TOKEN)return {published:0,failed:0};
 let published=0,failed=0;
 for(let i=0;i<3;i++){
  const rows=await db(env,'rpc/claim_due_post','POST',{});
  if(!rows[0])break;
  try{await publish(env,rows[0],db);published++;}
  catch{failed++;}
 }
 return {published,failed};
}

export async function runScheduled(event,env,db,handlers={publishDue,collectMetrics:null}){
 if(event.cron==='* * * * *')return handlers.publishDue(env,db);
 if(event.cron==='30 12 * * *'&&handlers.collectMetrics)return handlers.collectMetrics(env,db);
}
