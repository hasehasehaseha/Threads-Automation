begin;
do $$
declare actor uuid; slots uuid[]; b public.generation_batches; again public.generation_batches; overlap public.generation_batches;
 first_job public.generation_jobs; next_job public.generation_jobs; history jsonb; n bigint; base date:='2040-04-01';
begin
 select user_id into actor from members where active and role='admin' limit 1;
 select array_agg(id order by created_at,id) into slots from (select id,created_at from prompt_templates where active order by created_at,id limit 7) p;
 select count(*) into n from generation_jobs;
 -- Isolate the queue for chronological-claim assertions; transaction rolls everything back.
 update generation_jobs set status='needs_review' where kind='production' and status in ('queued','generating');
 select * into b from request_weekly_generation(actor,gen_random_uuid(),base,slots[1:3],array['08:00','12:00','20:00']);
 if cardinality(b.job_ids)<>7 or cardinality(b.new_job_ids)<>7 then raise exception 'seven days not queued';end if;
 if (select count(*) from generation_jobs)<>n+7 then raise exception 'wrong number of jobs';end if;
 if (select count(*) from generation_jobs where id=any(b.job_ids) and (prompt_snapshot->>'count')::integer=3 and prompt_snapshot->'times'='["08:00","12:00","20:00"]')<>7 then raise exception 'slot snapshot changed';end if;
 if (select array_agg(target_date order by target_date) from generation_jobs where id=any(b.job_ids))<>array[base,base+1,base+2,base+3,base+4,base+5,base+6] then raise exception 'date range wrong';end if;
 select * into again from request_weekly_generation(actor,b.id,base+1,slots,array['08:00','10:00','12:00','14:00','16:00','18:00','20:00']);
 if again.job_ids<>b.job_ids or again.prompt_snapshot<>b.prompt_snapshot then raise exception 'request replay changed jobs';end if;
 select * into again from request_weekly_generation(actor,gen_random_uuid(),base,slots,array['08:00','10:00','12:00','14:00','16:00','18:00','20:00']);
 if cardinality(again.new_job_ids)<>0 or again.job_ids<>b.job_ids or (select count(*) from generation_jobs)<>n+7 then raise exception 'existing days duplicated';end if;
 select * into overlap from request_weekly_generation(actor,gen_random_uuid(),base+6,slots[1:3],array['08:00','12:00','20:00']);
 if cardinality(overlap.new_job_ids)<>6 then raise exception 'overlap not reused';end if;
 select * into first_job from claim_history_generation_job();
 if first_job.target_date<>base then raise exception 'first day out of order';end if;
 if exists(select 1 from claim_history_generation_job()) then raise exception 'parallel day allowed';end if;
 perform complete_generation_job(first_job.id,first_job.claim_id,'[{"topic":"週検証1","body":"週検証の初日一つ目の文章"},{"topic":"週検証2","body":"週検証の初日二つ目の文章"},{"topic":"週検証3","body":"週検証の初日三つ目の文章"}]');
 select * into next_job from claim_history_generation_job();
 if next_job.target_date<>base+1 then raise exception 'second day out of order';end if;
 history:=history_for_generation(next_job.target_date);
 if (select count(*) from jsonb_array_elements(history) h where h->>'body' like '週検証の初日%')<>3 then raise exception 'next day cannot see prior drafts';end if;
 if not weekly_generation_pending() then raise exception 'pending batch not detected';end if;
 begin perform request_weekly_generation(gen_random_uuid(),gen_random_uuid(),base,slots[1:3],array['08:00','12:00','20:00']);raise exception 'inactive member allowed';
 exception when raise_exception then if sqlerrm<>'forbidden' then raise;end if;end;
 if has_table_privilege('authenticated','public.generation_batches','SELECT') or has_function_privilege('anon','public.request_weekly_generation(uuid,uuid,date,uuid[],text[])','EXECUTE') then raise exception 'browser access';end if;
end $$;
rollback;
select 'PASS: 7 daily snapshots, replay/overlap reuse, serial chronological claims, prior-day draft history, service-only access; fixtures rolled back' as result;
