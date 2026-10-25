import {runProduction} from './ai-generation.js';

// Each minute invocation runs at most one day. The shared DB claim serializes Make and cron.
// A closed browser or a repeated trigger cannot restart an already claimed day.
export async function runWeeklyGeneration(env,db,runner=runProduction){
 if(env.AI_HISTORY_ENABLED!=='true'||!env.OPENAI_API_KEY)return {processed:false};
 const pending=await db(env,'rpc/weekly_generation_pending','POST',{});
 if(!pending)return {processed:false};
 return runner(env,db);
}
