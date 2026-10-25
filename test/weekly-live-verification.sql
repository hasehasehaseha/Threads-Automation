-- Run after the UI smoke test for Nov 2-8 has finished; no API calls or publishing.
begin;
do $$
declare ids uuid[]; batch_id uuid; actor uuid; slots uuid[]; times text[]:=array['08:00','10:00','12:00','14:00','16:00','18:00','20:00']; b public.generation_batches; before_jobs bigint; before_usage bigint; n bigint;
begin
 select id,job_ids,created_by into batch_id,ids,actor from generation_batches where start_date='2026-11-02' order by created_at limit 1;
 if cardinality(ids) is distinct from 7 then raise exception 'weekly batch missing';end if;
 if (select count(*) from generation_jobs where id=any(ids) and status='completed' and cardinality(post_ids)=7)<>7 then raise exception 'week still processing or needs review';end if;
 select count(*) into n from posts where id in(select unnest(post_ids) from generation_jobs where id=any(ids));
 if n<>49 then raise exception 'expected 49 saved posts';end if;
 if exists(select 1 from posts where id in(select unnest(post_ids) from generation_jobs where id=any(ids)) and (status<>'draft' or approved_by is not null)) then raise exception 'unexpected approval or publication';end if;
 if (select count(distinct body) from posts where id in(select unnest(post_ids) from generation_jobs where id=any(ids)))<>49 then raise exception 'duplicate text';end if;
 if exists(select j.id from generation_jobs j join posts p on p.id=any(j.post_ids) where j.id=any(ids) group by j.id
 having array_agg(to_char(p.scheduled_at at time zone 'Asia/Tokyo','HH24:MI') order by p.scheduled_at)<>times or bool_or((p.scheduled_at at time zone 'Asia/Tokyo')::date<>j.target_date)) then raise exception 'date or time mapping wrong';end if;
 if exists(select 1 from generation_jobs where id=any(ids) and (ai_report->>'historyCount')::integer<>26+7*(target_date-'2026-11-02'::date)) then raise exception 'prior-day history missing';end if;
 if (select count(*) from ai_usage where job_id=any(ids) and purpose='generate')<>7 then raise exception 'expected one normal response per day';end if;
 select array_agg((e->>'id')::uuid order by ord) into slots from generation_batches batch_row,jsonb_array_elements(batch_row.prompt_snapshot->'templates') with ordinality t(e,ord) where batch_row.id=batch_id;
 select count(*) into before_jobs from generation_jobs;select count(*) into before_usage from ai_usage;
 select * into b from request_weekly_generation(actor,gen_random_uuid(),'2026-11-02',slots,times);
 if cardinality(b.new_job_ids)<>0 or b.job_ids<>ids then raise exception 'repeated week not reused';end if;
 if (select count(*) from generation_jobs)<>before_jobs or (select count(*) from ai_usage)<>before_usage then raise exception 'repeat created jobs or API calls';end if;
end $$;
rollback;
select 'PASS: 49 unapproved distinct drafts, 7 daily response calls, increasing prior-day history, repeated week reuses all jobs; verification rolled back' as result;
