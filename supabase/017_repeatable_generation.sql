begin;
alter table public.generation_jobs drop constraint generation_jobs_target_date_key;
create index generation_jobs_target_date_idx on public.generation_jobs(target_date);

create function public.request_repeatable_generation(p_actor uuid,p_request uuid,p_target date,p_slots uuid[],p_times text[]) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs; snapshot jsonb;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden';end if;
 if p_request is null then raise exception 'request id required';end if;
 perform pg_advisory_xact_lock(hashtext('generation-request:'||p_request::text));
 select * into j from generation_jobs where id=p_request;
 if j.id is not null then
  if j.created_by<>p_actor or j.kind<>'production' or j.target_date is distinct from p_target
   or j.prompt_snapshot->'times' is distinct from to_jsonb(p_times)
   or (select jsonb_agg(t->'id' order by n) from jsonb_array_elements(j.prompt_snapshot->'templates') with ordinality e(t,n)) is distinct from to_jsonb(p_slots)
  then raise exception 'request changed';end if;
  return j;
 end if;
 if p_target is null or p_target<(now() at time zone 'Asia/Tokyo')::date then raise exception 'choose today or later';end if;
 snapshot:=generation_snapshot(p_slots,p_times)||jsonb_build_object('target_date',p_target);
 if exists(select 1 from unnest(p_times) t where (p_target+t::time) at time zone 'Asia/Tokyo'<=now()) then raise exception 'choose future times';end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first';end if;
 insert into generation_jobs(id,created_by,settings_id,settings_snapshot,target_date,prompt_snapshot)
 values(p_request,p_actor,s.id,s.content,p_target,snapshot) returning * into j;
 return j;
end $$;

create or replace function public.request_configured_generation(p_actor uuid,p_target date,p_slots uuid[],p_times text[]) returns public.generation_jobs
language sql security definer set search_path=public as $$
 select public.request_repeatable_generation(p_actor,gen_random_uuid(),p_target,p_slots,p_times);
$$;

create or replace function public.request_weekly_generation(p_actor uuid,p_id uuid,p_start date,p_slots uuid[],p_times text[]) returns public.generation_batches
language plpgsql security definer set search_path=public as $$
declare b public.generation_batches; snapshot jsonb; j public.generation_jobs; ids uuid[]:='{}'; i integer;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden';end if;
 if p_id is null then raise exception 'request id required';end if;
 perform pg_advisory_xact_lock(hashtext('weekly-generation-request'));
 select * into b from generation_batches where id=p_id;
 if b.id is not null then
  if b.created_by<>p_actor or b.start_date is distinct from p_start
   or b.prompt_snapshot->'times' is distinct from to_jsonb(p_times)
   or (select jsonb_agg(t->'id' order by n) from jsonb_array_elements(b.prompt_snapshot->'templates') with ordinality e(t,n)) is distinct from to_jsonb(p_slots)
  then raise exception 'request changed';end if;
  return b;
 end if;
 snapshot:=generation_snapshot(p_slots,p_times);
 for i in 0..6 loop
  j:=request_repeatable_generation(p_actor,gen_random_uuid(),p_start+i,p_slots,p_times);
  ids:=array_append(ids,j.id);
 end loop;
 insert into generation_batches(id,created_by,start_date,prompt_snapshot,job_ids,new_job_ids)
 values(p_id,p_actor,p_start,snapshot,ids,ids) returning * into b;
 return b;
end $$;
revoke all on function public.request_repeatable_generation(uuid,uuid,date,uuid[],text[]) from public,anon,authenticated;
grant execute on function public.request_repeatable_generation(uuid,uuid,date,uuid[],text[]) to service_role;
commit;
