-- Run in the Supabase SQL editor; every fixture and change is rolled back.
begin;
do $$
declare actor uuid; n bigint; j public.generation_jobs; p public.prompt_templates; claim uuid; snapshot text;
 drafts jsonb:='[{"topic":"検証A","body":"検証本文A"},{"topic":"検証B","body":"検証本文B"},{"topic":"検証C","body":"検証本文C"}]';
begin
 select user_id into actor from public.members where active and role='admin' order by user_id limit 1;
 select count(*) into n from public.posts;
 select * into j from public.request_prompt_test(actor,'{"mode":"test","templates":[{"name":"DB検証","category":"テスト","instructions":"テスト用"}]}');
 update public.generation_jobs set status='generating',claim_id=gen_random_uuid() where id=j.id returning claim_id into claim;
 select * into j from public.complete_generation_job(j.id,claim,drafts);
 if j.status<>'completed' or jsonb_array_length(j.preview_posts)<>3 or j.post_ids is not null then raise exception 'test result isolation failed'; end if;
 if (select count(*) from public.posts)<>n then raise exception 'test created real posts'; end if;
 perform public.complete_generation_job(j.id,claim,drafts);
 if (select count(*) from public.posts)<>n then raise exception 'duplicate callback created posts'; end if;
 -- Temporarily free tomorrow's unique slot, without deleting any saved job.
 update public.generation_jobs set target_date=target_date+3650 where kind='production' and target_date=(now() at time zone 'Asia/Tokyo')::date+1;
 select * into j from public.request_generation_job(actor);
 if jsonb_array_length(j.prompt_snapshot->'templates')<>3 then raise exception 'missing prompt plan'; end if;
 snapshot:=j.prompt_snapshot->'templates'->0->>'instructions';
 update public.prompt_templates set instructions='変更後の検証用指示' where id=(j.prompt_snapshot->'templates'->0->>'id')::uuid;
 if (select prompt_snapshot->'templates'->0->>'instructions' from public.generation_jobs where id=j.id) is distinct from snapshot then raise exception 'snapshot changed'; end if;
 update public.generation_jobs set status='generating',claim_id=gen_random_uuid() where id=j.id returning claim_id into claim;
 select * into j from public.complete_generation_job(j.id,claim,drafts);
 if cardinality(j.post_ids)<>3 or j.preview_posts is not null then raise exception 'production drafts missing'; end if;
 if (select count(*) from public.posts where id=any(j.post_ids) and status='draft' and approved_by is null)<>3 then raise exception 'production unexpectedly approved'; end if;
 perform public.complete_generation_job(j.id,claim,drafts);
 if (select count(*) from public.posts)<>n+3 then raise exception 'duplicate production callback'; end if;
 if has_table_privilege('anon','public.prompt_templates','SELECT') or has_function_privilege('authenticated','public.request_prompt_test(uuid,jsonb)','EXECUTE') then raise exception 'public access not blocked'; end if;
end $$;
rollback;
select 'prompt test isolation, immutable snapshots, draft-only production and replay protection passed; fixtures rolled back' as result;
