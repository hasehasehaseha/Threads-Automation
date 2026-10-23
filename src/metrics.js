export const metricNames=['views','likes','replies','reposts','quotes','shares'];
export function parseMetrics(payload){
 if(!Array.isArray(payload?.data))throw new Error('Invalid insights');
 const result=Object.fromEntries(metricNames.map(k=>[k,null]));
 for(const row of payload.data){
  if(!metricNames.includes(row.name))continue;
  const value=row.values?.[0]?.value;
  if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid metric');
  result[row.name]=value;
 }
 if(Object.values(result).every(v=>v===null))throw new Error('Missing insights');
 return result;
}
export async function collectMetrics(env,db){
 if(!env.THREADS_ACCESS_TOKEN)throw new Error('Threads接続は未設定です');
 // Bounded to fit the free Worker subrequest budget. Older posts remain in history.
 const posts=await db(env,'posts?status=eq.published&meta_post_id=not.is.null&order=scheduled_at.desc&limit=15&select=id,meta_post_id');
 const recent=await db(env,'metric_snapshots?captured_at=gte.'+encodeURIComponent(new Date(Date.now()-3600000).toISOString())+'&select=post_id&limit=100');
 const done=new Set(recent.map(r=>r.post_id));let saved=0,failed=0,skipped=0;
 for(const post of posts){
  if(done.has(post.id)){skipped++;continue;}
  try{
   if(!/^\d{1,100}$/.test(post.meta_post_id))throw new Error();
   const r=await fetch('https://graph.threads.net/v1.0/'+post.meta_post_id+'/insights?metric='+metricNames.join(','),{headers:{Authorization:'Bearer '+env.THREADS_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new Error();
   const values=parseMetrics(await r.json());
   await db(env,'metric_snapshots','POST',{post_id:post.id,...values});saved++;
  }catch{failed++;}
 }
 return {saved,failed,skipped,total:posts.length};
}
