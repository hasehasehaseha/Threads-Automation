-- Read/check inside a rolled-back transaction; no saved fixtures.
begin;
do $$
declare actor uuid; target date; j public.generation_jobs; again public.generation_jobs; claim uuid; n bigint;
begin
 select user_id into actor from public.members where active and role='admin' limit 1;
 target:=(now() at time zone 'Asia/Tokyo')::date+400;
 while exists(select 1 from public.generation_jobs where target_date=target) loop target:=target+1; end loop;
 select count(*) into n from public.posts;
 select * into j from public.request_generation_for_date(actor,target);
 select * into again from public.request_generation_for_date(actor,target);
 if j.id<>again.id or j.target_date<>target or j.prompt_snapshot->>'target_date'<>target::text then raise exception 'date/dedup failed'; end if;
 update public.generation_jobs set status='generating',claim_id=gen_random_uuid() where id=j.id returning claim_id into claim;
 select * into j from public.complete_generation_job(j.id,claim,'[{"topic":"日付A","body":"検証A"},{"topic":"日付B","body":"検証B"},{"topic":"日付C","body":"検証C"}]');
 if (select count(*) from public.posts where id=any(j.post_ids) and status='draft' and approved_by is null and (scheduled_at at time zone 'Asia/Tokyo')::date=target and (scheduled_at at time zone 'Asia/Tokyo')::time in ('08:00','12:00','20:00'))<>3 then raise exception 'wrong draft dates'; end if;
 perform public.complete_generation_job(j.id,claim,'[]');
 if (select count(*) from public.posts)<>n+3 then raise exception 'duplicate results'; end if;
 begin
  perform public.request_generation_for_date(actor,(now() at time zone 'Asia/Tokyo')::date-1);
  raise exception 'past date accepted';
 exception when raise_exception then
  if sqlerrm<>'choose today or later' then raise; end if;
 end;
 if has_function_privilege('anon','public.request_generation_for_date(uuid,date)','EXECUTE') or has_function_privilege('authenticated','public.request_generation_for_date(uuid,date)','EXECUTE') then raise exception 'public access'; end if;
end $$;
rollback;
select 'date, three unapproved drafts, deduplication and permissions passed; rolled back' as result;
