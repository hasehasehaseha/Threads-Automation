import {runProduction} from './ai-generation.js';

// Each minute invocation runs at most one queued day, including standalone requests.
// The shared DB claim serializes immediate starts, Make and cron.
// A closed browser or a repeated trigger cannot restart an already claimed day.
export async function runWeeklyGeneration(env,db,runner=runProduction){
 if(env.AI_HISTORY_ENABLED!=='true'||!env.OPENAI_API_KEY)return {processed:false};
 const pending=await db(env,'generation_jobs?kind=eq.production&status=eq.queued&select=id&limit=1');
 if(!pending.length)return {processed:false};
 return runner(env,db);
}
