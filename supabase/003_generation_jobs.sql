begin;
create table public.generation_jobs (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references public.members(user_id),
 settings_id bigint not null references public.editorial_settings(id),
 settings_snapshot jsonb not null,
 target_date date not null unique,
 status text not null default 'queued' check(status in ('queued','generating','completed','needs_review')),
 claim_id uuid,
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 post_ids uuid[]
);
alter table public.generation_jobs enable row level security;
revoke all on public.generation_jobs from public,anon,authenticated;
grant all on public.generation_jobs to service_role;

create function public.request_generation_job(p_actor uuid) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs; target date;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden'; end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first'; end if;
 target := (now() at time zone 'Asia/Tokyo')::date+1;
 insert into generation_jobs(created_by,settings_id,settings_snapshot,target_date)
 values(p_actor,s.id,s.content,target) on conflict(target_date) do nothing returning * into j;
 if j.id is null then select * into j from generation_jobs where target_date=target; end if;
 return j;
end $$;

create function public.claim_generation_job() returns setof public.generation_jobs
language plpgsql security definer set search_path=public as $$
begin
 update generation_jobs set status='needs_review' where status='generating' and claimed_at<now()-interval '15 minutes';
 update generation_jobs set status='needs_review' where status='queued' and target_date<=(now() at time zone 'Asia/Tokyo')::date;
 return query update generation_jobs set status='generating',claim_id=gen_random_uuid(),claimed_at=now()
 where id=(select j.id from generation_jobs j join members m on m.user_id=j.created_by and m.active
 where j.status='queued' order by j.created_at for update of j skip locked limit 1) returning *;
end $$;

create function public.complete_generation_job(p_id uuid,p_claim uuid,p_posts jsonb) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare j public.generation_jobs; entry jsonb; post_id uuid; ids uuid[] := '{}'; slot time; n integer:=0;
begin
 select * into j from generation_jobs where id=p_id for update;
 if j.id is null or j.claim_id is distinct from p_claim then raise exception 'invalid claim'; end if;
 if j.status='completed' then return j; end if;
 if j.status not in ('generating','needs_review') then raise exception 'invalid status'; end if;
 if not exists(select 1 from members where user_id=j.created_by and active) then raise exception 'forbidden'; end if;
 if jsonb_typeof(p_posts)<>'array' or jsonb_array_length(p_posts)<>3 then raise exception 'three drafts required'; end if;
 for entry in select * from jsonb_array_elements(p_posts) loop
  n:=n+1;slot:=case n when 1 then time '08:00' when 2 then time '12:00' else time '20:00' end;
  if jsonb_typeof(entry->'body')<>'string' or jsonb_typeof(entry->'topic')<>'string' or length(entry->>'topic')>100 then raise exception 'invalid draft'; end if;
  insert into posts(body,topic,scheduled_at,settings_id,created_by,status)
  values(entry->>'body',entry->>'topic',(j.target_date+slot) at time zone 'Asia/Tokyo',j.settings_id,j.created_by,'draft') returning id into post_id;
  ids:=array_append(ids,post_id);
  insert into audit_log(actor,post_id,action) values(j.created_by,post_id,'ai_draft');
 end loop;
 update generation_jobs set status='completed',completed_at=now(),post_ids=ids where id=p_id returning * into j;
 return j;
end $$;
revoke all on function public.request_generation_job(uuid),public.claim_generation_job(),public.complete_generation_job(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.request_generation_job(uuid),public.claim_generation_job(),public.complete_generation_job(uuid,uuid,jsonb) to service_role;
commit;
