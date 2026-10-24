begin;
alter table public.generation_jobs add column test_error text;
create or replace function public.begin_immediate_prompt_test(p_actor uuid,p_snapshot jsonb,p_id uuid,p_claim uuid) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden'; end if;
 if p_id is null or p_claim is null or p_snapshot->>'mode' is distinct from 'test' or p_snapshot->>'count' is distinct from '1' then raise exception 'single test required'; end if;
 perform pg_advisory_xact_lock(hashtext('prompt-test:'||p_actor::text));
 select * into j from generation_jobs where id=p_id;
 if j.id is not null then
 if j.created_by<>p_actor or j.kind<>'test' then raise exception 'forbidden';end if;
 return j;
 end if;
 update generation_jobs set status='needs_review',test_error='前回のテストの応答を確認できませんでした。' where created_by=p_actor and kind='test' and prompt_snapshot->>'delivery'='direct' and status='generating' and claimed_at<now()-interval '2 minutes';
 if (select count(*) from generation_jobs where created_by=p_actor and kind='test' and created_at>now()-interval '1 hour')>=10 then raise exception 'test limit; wait one hour'; end if;
 if exists(select 1 from generation_jobs where created_by=p_actor and kind='test' and status in ('queued','generating') and created_at>now()-interval '20 minutes') then raise exception 'test running; wait for result'; end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first'; end if;
 insert into generation_jobs(id,created_by,settings_id,settings_snapshot,target_date,kind,prompt_snapshot,status,claim_id,claimed_at)
 values(p_id,p_actor,s.id,s.content,null,'test',p_snapshot,'generating',p_claim,now()) returning * into j;
 return j;
end $$;
revoke all on function public.begin_immediate_prompt_test(uuid,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_immediate_prompt_test(uuid,jsonb,uuid,uuid) to service_role;
create or replace function public.complete_generation_job(p_id uuid,p_claim uuid,p_posts jsonb) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare j public.generation_jobs; entry jsonb; post_id uuid; ids uuid[]:='{}'; slot time; n integer:=0; expected integer; times jsonb;
begin
 select * into j from generation_jobs where id=p_id for update;
 if j.id is null or j.claim_id is distinct from p_claim or p_claim is null then raise exception 'invalid claim'; end if;
 if j.status='completed' then return j; end if;
 if j.status not in ('generating','needs_review') then raise exception 'invalid status'; end if;
 if not exists(select 1 from members where user_id=j.created_by and active) then raise exception 'forbidden'; end if;
 expected:=coalesce((j.prompt_snapshot->>'count')::integer,3);
 if expected not between 1 and 7 or jsonb_typeof(p_posts) is distinct from 'array' or jsonb_array_length(p_posts)<>expected then raise exception 'wrong draft count'; end if;
 if (select count(distinct trim(e->>'body')) from jsonb_array_elements(p_posts) e)<>expected then raise exception 'duplicate bodies'; end if;
 for entry in select * from jsonb_array_elements(p_posts) loop
 if jsonb_typeof(entry->'body') is distinct from 'string' or jsonb_typeof(entry->'topic') is distinct from 'string'
 or length(trim(entry->>'body')) not between 1 and 500 or length(trim(entry->>'topic')) not between 1 and 100 then raise exception 'invalid draft'; end if;
 end loop;
 if j.kind='test' then
 update generation_jobs set status='completed',completed_at=now(),preview_posts=p_posts,test_error=null where id=p_id returning * into j;
 return j;
 end if;
 times:=coalesce(j.prompt_snapshot->'times','["08:00","12:00","20:00"]'::jsonb);
 if jsonb_array_length(times)<>expected then raise exception 'invalid times snapshot'; end if;
 if exists(select 1 from jsonb_array_elements_text(times) t where (j.target_date+t::time) at time zone 'Asia/Tokyo'<=now()) then
 update generation_jobs set status='needs_review' where id=p_id returning * into j;return j;
 end if;
 for entry in select * from jsonb_array_elements(p_posts) loop
 n:=n+1;slot:=(times->>(n-1))::time;
 insert into posts(body,topic,scheduled_at,settings_id,created_by,status)
 values(entry->>'body',entry->>'topic',(j.target_date+slot) at time zone 'Asia/Tokyo',j.settings_id,j.created_by,'draft') returning id into post_id;
 ids:=array_append(ids,post_id);
 insert into audit_log(actor,post_id,action) values(j.created_by,post_id,'ai_draft');
 end loop;
 update generation_jobs set status='completed',completed_at=now(),post_ids=ids where id=p_id returning * into j;
 return j;
end $$;
commit;
