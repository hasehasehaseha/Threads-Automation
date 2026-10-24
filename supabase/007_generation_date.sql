-- Explicit future date; keep the existing tomorrow API compatible.
begin;
create or replace function public.request_generation_for_date(p_actor uuid,p_target date) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs; target date; selected jsonb;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden'; end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first'; end if;
 target:=p_target;
 if target is null or target<=(now() at time zone 'Asia/Tokyo')::date then raise exception 'choose tomorrow or later'; end if;
 select * into j from generation_jobs where target_date=target;
 if j.id is not null then return j; end if;
 select jsonb_agg(jsonb_build_object('id',t.id,'version',t.version,'name',t.name,'category',t.category,'instructions',t.instructions) order by u.n) into selected
 from prompt_plan p cross join lateral unnest(p.slots) with ordinality u(id,n) join prompt_templates t on t.id=u.id and t.active where p.id=1;
 if selected is null or jsonb_array_length(selected)<>3 then raise exception 'configure three active prompts'; end if;
 insert into generation_jobs(created_by,settings_id,settings_snapshot,target_date,prompt_snapshot)
 values(p_actor,s.id,s.content,target,jsonb_build_object('mode','production','target_date',target,'templates',selected)) on conflict(target_date) do nothing returning * into j;
 if j.id is null then select * into j from generation_jobs where target_date=target; end if;
 return j;
end $$;

create or replace function public.request_generation_job(p_actor uuid) returns public.generation_jobs
language sql security definer set search_path=public as $$
 select public.request_generation_for_date(p_actor,(now() at time zone 'Asia/Tokyo')::date+1);
$$;
revoke all on function public.request_generation_for_date(uuid,date) from public,anon,authenticated;
grant execute on function public.request_generation_for_date(uuid,date) to service_role;
commit;
