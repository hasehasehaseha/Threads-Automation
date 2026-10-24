begin;
do $$
declare actor uuid; target date; j public.generation_jobs; j2 public.generation_jobs; plan public.prompt_plan;
 ids uuid[]; times text[]; claim uuid; data jsonb; n integer; p public.posts; original text;
begin
 select user_id into actor from members where active and role='admin' limit 1;
 select array_agg(id order by created_at,id) into ids from prompt_templates where active;
 if cardinality(ids)<7 then raise exception 'seven prompts missing'; end if;
 target:=(now() at time zone 'Asia/Tokyo')::date+500;
 while exists(select 1 from generation_jobs where target_date=target) or exists(select 1 from posts where (scheduled_at at time zone 'Asia/Tokyo')::date=target) loop target:=target+1; end loop;
 foreach n in array array[1,3,5,7] loop
  times:=(array['09:10','10:20','12:30','14:40','16:50','18:00','20:10'])[1:n];
  select * into j from request_configured_generation(actor,target,ids[1:n],times);
  select * into j2 from request_configured_generation(actor,target,ids[1:n],times);
  if j.id<>j2.id or (j.prompt_snapshot->>'count')::integer<>n or j.prompt_snapshot->'times'<>to_jsonb(times) then raise exception 'snapshot/dedup'; end if;
  original:=j.prompt_snapshot->'templates'->0->>'instructions';
  update prompt_templates set instructions='変更後のテスト指示' where id=ids[1];
  if (select prompt_snapshot->'templates'->0->>'instructions' from generation_jobs where id=j.id) is distinct from original then raise exception 'mutable snapshot'; end if;
  update generation_jobs set status='generating',claim_id=gen_random_uuid() where id=j.id returning claim_id into claim;
  select jsonb_agg(jsonb_build_object('topic','検証'||i,'body','指定件数の検証'||i) order by i) into data from generate_series(1,n) i;
  begin
   perform complete_generation_job(j.id,claim,'[]');raise exception 'wrong count accepted';
  exception when raise_exception then if sqlerrm<>'wrong draft count' then raise; end if; end;
  select * into j from complete_generation_job(j.id,claim,data);
  if cardinality(j.post_ids)<>n or (select count(*) from posts where id=any(j.post_ids) and status='draft' and approved_by is null)<>n then raise exception 'wrong/unapproved drafts'; end if;
  for p in select * from posts where id=any(j.post_ids) loop
   if (p.scheduled_at at time zone 'Asia/Tokyo')::date<>target or not ((to_char(p.scheduled_at at time zone 'Asia/Tokyo','HH24:MI'))=any(times)) then raise exception 'wrong date/time'; end if;
  end loop;
  perform complete_generation_job(j.id,claim,data);
  if (select count(*) from posts where id=any(j.post_ids))<>n then raise exception 'duplicate callback'; end if;
  if n=7 then
   for p in select * from posts where id=any(j.post_ids) loop perform mutate_post(actor,'approve',p.id,p.version);end loop;
   select * into p from mutate_post(actor,'create',null,null,'超過検証','超過',(target+time '21:00') at time zone 'Asia/Tokyo');
   begin perform mutate_post(actor,'approve',p.id,p.version);raise exception 'eighth approval accepted';
   exception when raise_exception then if sqlerrm<>'daily limit' then raise; end if; end;
  end if;
  target:=target+1;
 end loop;
 select * into plan from prompt_plan where id=1;
 select * into plan from save_generation_plan(actor,plan.version,ids[1:5],array['09:10','10:20','12:30','14:40','16:50']);
 if cardinality(plan.slots)<>5 or cardinality(plan.times)<>5 then raise exception 'plan failed'; end if;
 -- Today is accepted when all requested times are still ahead; existing day is moved only inside rollback.
 if (now() at time zone 'Asia/Tokyo')::time<time '23:58' then
  update generation_jobs set target_date=target_date+2000 where target_date=(now() at time zone 'Asia/Tokyo')::date;
  select * into j from request_configured_generation(actor,(now() at time zone 'Asia/Tokyo')::date,ids[1:1],array['23:59']);
  if j.target_date<>(now() at time zone 'Asia/Tokyo')::date then raise exception 'today rejected'; end if;
  if not exists(select 1 from claim_generation_job() where id=j.id) then raise exception 'today claim failed'; end if;
 end if;
 if has_function_privilege('anon','public.request_configured_generation(uuid,date,uuid[],text[])','EXECUTE') or has_function_privilege('authenticated','public.save_generation_plan(uuid,integer,uuid[],text[])','EXECUTE') then raise exception 'public access'; end if;
end $$;
rollback;
select '1/3/5/7 drafts, time mapping, immutable prompts, today claim, saved plan, seven approvals, dedup and permissions passed; rolled back' as result;
