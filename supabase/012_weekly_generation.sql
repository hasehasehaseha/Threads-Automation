begin;
create table public.generation_batches (
 id uuid primary key, created_by uuid not null references public.members(user_id),
 start_date date not null, prompt_snapshot jsonb not null,
 job_ids uuid[] not null check(cardinality(job_ids)=7), new_job_ids uuid[] not null,
 created_at timestamptz not null default now()
);
alter table public.generation_batches enable row level security;
revoke all on public.generation_batches from public,anon,authenticated;
grant all on public.generation_batches to service_role;
create function public.request_weekly_generation(p_actor uuid,p_id uuid,p_start date,p_slots uuid[],p_times text[]) returns public.generation_batches
language plpgsql security definer set search_path=public as $$
declare b public.generation_batches; s public.editorial_settings; snapshot jsonb; j public.generation_jobs; ids uuid[]:='{}'; fresh uuid[]:='{}'; d date; i integer;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden';end if;
 if p_id is null then raise exception 'request id required';end if;
 perform pg_advisory_xact_lock(hashtext('weekly-generation-request'));
 select * into b from generation_batches where id=p_id;
 if b.id is not null then if b.created_by<>p_actor then raise exception 'forbidden';end if;return b;end if;
 if p_start is null or p_start<(now() at time zone 'Asia/Tokyo')::date then raise exception 'choose today or later';end if;
 snapshot:=generation_snapshot(p_slots,p_times);
 if exists(select 1 from unnest(p_times) t where (p_start+t::time) at time zone 'Asia/Tokyo'<=now()) then raise exception 'choose future times';end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first';end if;
 for i in 0..6 loop
  d:=p_start+i;
  insert into generation_jobs(created_by,settings_id,settings_snapshot,target_date,prompt_snapshot)
  values(p_actor,s.id,s.content,d,snapshot||jsonb_build_object('target_date',d))
  on conflict(target_date) do nothing returning * into j;
  if j.id is not null then fresh:=array_append(fresh,j.id);else select * into j from generation_jobs where target_date=d;end if;
  ids:=array_append(ids,j.id);
 end loop;
 insert into generation_batches(id,created_by,start_date,prompt_snapshot,job_ids,new_job_ids)
 values(p_id,p_actor,p_start,snapshot,ids,fresh) returning * into b;
 return b;
end $$;
create function public.weekly_generation_status() returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('jobs',(
 select jsonb_agg(jsonb_build_object('id',j.id,'target_date',j.target_date,'status',j.status,'count',coalesce((j.prompt_snapshot->>'count')::integer,3),'new',j.id=any(b.new_job_ids),'error',j.test_error) order by j.target_date)
 from generation_jobs j where j.id=any(b.job_ids))) order by b.created_at desc),'[]')
 from (select id,start_date,prompt_snapshot,job_ids,new_job_ids,created_at from generation_batches order by created_at desc limit 10) b;
$$;
create function public.weekly_generation_pending() returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from generation_batches b join members m on m.user_id=b.created_by and m.active
 join generation_jobs j on j.id=any(b.job_ids) join members owner on owner.user_id=j.created_by and owner.active
 where j.status in ('queued','generating'));
$$;
create or replace function public.claim_history_generation_job() returns setof public.generation_jobs
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext('history-generation-claim'));
 update generation_jobs set status='needs_review',test_error='生成の応答を確認できませんでした。自動再実行はしません。'
 where kind='production' and status='generating' and claimed_at<now()-interval '15 minutes';
 update generation_jobs j set status='needs_review',test_error='投稿予定時刻を過ぎたため確認待ちにしました。'
 where status='queued' and kind='production' and (target_date<(now() at time zone 'Asia/Tokyo')::date or exists(
 select 1 from jsonb_array_elements_text(coalesce(j.prompt_snapshot->'times','["08:00","12:00","20:00"]'::jsonb)) t where (j.target_date+t::time) at time zone 'Asia/Tokyo'<=now()));
 if exists(select 1 from generation_jobs where kind='production' and status='generating') then return;end if;
 return query update generation_jobs set status='generating',claim_id=gen_random_uuid(),claimed_at=now()
 where id=(select j.id from generation_jobs j join members m on m.user_id=j.created_by and m.active
 where j.kind='production' and j.status='queued' order by j.target_date,j.created_at for update of j skip locked limit 1) returning *;
end $$;
revoke all on function public.request_weekly_generation(uuid,uuid,date,uuid[],text[]),public.weekly_generation_status(),public.weekly_generation_pending() from public,anon,authenticated;
grant execute on function public.request_weekly_generation(uuid,uuid,date,uuid[],text[]),public.weekly_generation_status(),public.weekly_generation_pending() to service_role;
commit;
