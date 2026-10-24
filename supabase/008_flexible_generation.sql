begin;
alter table public.prompt_plan drop constraint prompt_plan_slots_check;
alter table public.prompt_plan add constraint prompt_plan_slots_check check(cardinality(slots) between 1 and 7);
alter table public.prompt_plan add column times text[] not null default array['08:00','12:00','20:00'];
alter table public.prompt_plan add constraint prompt_plan_times_check check(cardinality(times)=cardinality(slots));

create or replace function public.generation_snapshot(p_slots uuid[],p_times text[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare selected jsonb; n integer;
begin
 n:=cardinality(p_slots);
 if n is null or n not between 1 and 7 or cardinality(p_times) is distinct from n then raise exception 'choose 1 to 7 slots'; end if;
 if exists(select 1 from unnest(p_times) t where t is null or t!~'^([01][0-9]|2[0-3]):[0-5][0-9]$') or (select count(distinct t) from unnest(p_times) t)<>n then raise exception 'invalid or duplicate times'; end if;
 select jsonb_agg(jsonb_build_object('id',t.id,'version',t.version,'name',t.name,'category',t.category,'instructions',t.instructions) order by u.n) into selected
 from unnest(p_slots) with ordinality u(id,n) join prompt_templates t on t.id=u.id and t.active;
 if selected is null or jsonb_array_length(selected)<>n then raise exception 'active prompts required'; end if;
 return jsonb_build_object('mode','production','count',n,'times',to_jsonb(p_times),'templates',selected);
end $$;

create or replace function public.save_generation_plan(p_actor uuid,p_version integer,p_slots uuid[],p_times text[]) returns public.prompt_plan
language plpgsql security definer set search_path=public as $$
declare plan public.prompt_plan;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required'; end if;
 perform public.generation_snapshot(p_slots,p_times);
 select * into plan from prompt_plan where id=1 for update;
 if plan.version is distinct from p_version then raise exception 'plan changed; reload'; end if;
 update prompt_plan set slots=p_slots,times=p_times,version=version+1,updated_by=p_actor,updated_at=now() where id=1 returning * into plan;
 return plan;
end $$;

create or replace function public.request_configured_generation(p_actor uuid,p_target date,p_slots uuid[],p_times text[]) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs; snapshot jsonb;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden'; end if;
 if p_target is null or p_target<(now() at time zone 'Asia/Tokyo')::date then raise exception 'choose today or later'; end if;
 snapshot:=public.generation_snapshot(p_slots,p_times)||jsonb_build_object('target_date',p_target);
 if exists(select 1 from unnest(p_times) t where (p_target+t::time) at time zone 'Asia/Tokyo'<=now()) then raise exception 'choose future times'; end if;
 select * into j from generation_jobs where target_date=p_target;
 if j.id is not null then return j; end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first'; end if;
 insert into generation_jobs(created_by,settings_id,settings_snapshot,target_date,prompt_snapshot)
 values(p_actor,s.id,s.content,p_target,snapshot) on conflict(target_date) do nothing returning * into j;
 if j.id is null then select * into j from generation_jobs where target_date=p_target; end if;
 return j;
end $$;

create or replace function public.request_generation_for_date(p_actor uuid,p_target date) returns public.generation_jobs
language sql security definer set search_path=public as $$
 select public.request_configured_generation(p_actor,p_target,p.slots,p.times) from prompt_plan p where p.id=1;
$$;

create or replace function public.claim_generation_job() returns setof public.generation_jobs
language plpgsql security definer set search_path=public as $$
begin
 update generation_jobs set status='needs_review' where status='generating' and claimed_at<now()-interval '15 minutes';
 update generation_jobs j set status='needs_review' where status='queued' and kind='production' and
 (target_date<(now() at time zone 'Asia/Tokyo')::date or exists(select 1 from jsonb_array_elements_text(coalesce(j.prompt_snapshot->'times','["08:00","12:00","20:00"]'::jsonb)) t where (j.target_date+t::time) at time zone 'Asia/Tokyo'<=now()));
 return query update generation_jobs set status='generating',claim_id=gen_random_uuid(),claimed_at=now()
 where id=(select j.id from generation_jobs j join members m on m.user_id=j.created_by and m.active where j.status='queued' order by j.created_at for update of j skip locked limit 1) returning *;
end $$;
create or replace function public.complete_generation_job(p_id uuid,p_claim uuid,p_posts jsonb) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare j public.generation_jobs; entry jsonb; post_id uuid; ids uuid[]:='{}'; slot time; n integer:=0; expected integer; times jsonb;
begin
 select * into j from generation_jobs where id=p_id for update;
 if j.id is null or j.claim_id is distinct from p_claim or p_claim is null then raise exception 'invalid claim'; end if;
 if j.status='completed' then return j; end if;
 if j.status not in ('generating','needs_review') then raise exception 'invalid status'; end if;
 if not exists(select 1 from members where user_id=j.created_by and active) then raise exception 'forbidden'; end if;
 expected:=case when j.kind='test' then 3 else coalesce((j.prompt_snapshot->>'count')::integer,3) end;
 if expected not between 1 and 7 or jsonb_typeof(p_posts) is distinct from 'array' or jsonb_array_length(p_posts)<>expected then raise exception 'wrong draft count'; end if;
 if (select count(distinct trim(e->>'body')) from jsonb_array_elements(p_posts) e)<>expected then raise exception 'duplicate bodies'; end if;
 for entry in select * from jsonb_array_elements(p_posts) loop
 if jsonb_typeof(entry->'body') is distinct from 'string' or jsonb_typeof(entry->'topic') is distinct from 'string'
 or length(trim(entry->>'body')) not between 1 and 500 or length(trim(entry->>'topic')) not between 1 and 100 then raise exception 'invalid draft'; end if;
 end loop;
 if j.kind='test' then
 update generation_jobs set status='completed',completed_at=now(),preview_posts=p_posts where id=p_id returning * into j;
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
create or replace function public.mutate_post(p_actor uuid,p_action text,p_id uuid,p_version integer,p_body text default null,p_topic text default '',p_at timestamptz default null,p_settings bigint default null)
returns public.posts language plpgsql security definer set search_path=public as $$
declare m public.members; p public.posts;
begin
 select * into m from members where user_id=p_actor and active;
 if m.user_id is null then raise exception 'forbidden'; end if;
 if p_action='create' then
   insert into posts(body,topic,scheduled_at,settings_id,created_by) values(p_body,p_topic,p_at,p_settings,p_actor) returning * into p;
 else
   select * into p from posts where id=p_id for update;
   if p.id is null or p.version<>p_version then raise exception 'conflict'; end if;
   if p.status not in ('draft','scheduled') then raise exception 'locked'; end if;
   if p_action='edit' then
     if p.status='scheduled' and m.role<>'admin' then raise exception 'forbidden'; end if;
     update posts set body=p_body,topic=p_topic,scheduled_at=p_at,settings_id=p_settings,status='draft',approved_by=null,version=version+1,updated_at=now() where id=p_id returning * into p;
   elsif p_action='approve' then
     if m.role<>'admin' then raise exception 'forbidden'; end if;
     if p.status<>'draft' or p.scheduled_at is null or p.scheduled_at<=now() then raise exception 'invalid schedule'; end if;
     if (select count(*) from posts where status in ('scheduled','publishing','published') and (scheduled_at at time zone 'Asia/Tokyo')::date=(p.scheduled_at at time zone 'Asia/Tokyo')::date)>=7 then raise exception 'daily limit'; end if;
     -- Serialize approvals across different posts for the same date.
     perform pg_advisory_xact_lock(hashtext((p.scheduled_at at time zone 'Asia/Tokyo')::date::text));
     if (select count(*) from posts where status in ('scheduled','publishing','published') and (scheduled_at at time zone 'Asia/Tokyo')::date=(p.scheduled_at at time zone 'Asia/Tokyo')::date)>=7 then raise exception 'daily limit'; end if;
     update posts set status='scheduled',approved_by=p_actor,version=version+1,updated_at=now() where id=p_id returning * into p;
   elsif p_action='cancel' then
     if m.role<>'admin' or p.status<>'scheduled' then raise exception 'forbidden'; end if;
     update posts set status='draft',approved_by=null,version=version+1,updated_at=now() where id=p_id returning * into p;
   else raise exception 'unknown action'; end if;
 end if;
 insert into audit_log(actor,post_id,action) values(p_actor,p.id,p_action);
 return p;
end $$;

create or replace function public.claim_immediate_post(p_actor uuid,p_id uuid,p_version integer)
returns public.posts language plpgsql security definer set search_path=public as $$
declare p public.posts; today date;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required'; end if;
 select * into p from posts where id=p_id for update;
 if not found or p.version<>p_version or p.status not in ('draft','scheduled') then raise exception 'post changed or already claimed'; end if;
 today:=(now() at time zone 'Asia/Tokyo')::date;
 perform pg_advisory_xact_lock(hashtext(today::text));
 if (select count(*) from posts where id<>p_id and status in ('scheduled','publishing','published','needs_review')
 and (scheduled_at at time zone 'Asia/Tokyo')::date=today)>=7 then raise exception 'daily limit'; end if;
 update posts set status='publishing',scheduled_at=clock_timestamp(),approved_by=p_actor,
 claim_id=gen_random_uuid(),claimed_at=now(),version=version+1,updated_at=now()
 where id=p_id returning * into p;
 insert into audit_log(actor,post_id,action) values(p_actor,p_id,'publish_now');
 return p;
end $$;

revoke all on function public.generation_snapshot(uuid[],text[]),public.save_generation_plan(uuid,integer,uuid[],text[]),public.request_configured_generation(uuid,date,uuid[],text[]) from public,anon,authenticated;
grant execute on function public.generation_snapshot(uuid[],text[]),public.save_generation_plan(uuid,integer,uuid[],text[]),public.request_configured_generation(uuid,date,uuid[],text[]) to service_role;
do $$ declare actor uuid; begin
 select user_id into actor from members where active and role='admin' order by user_id limit 1;
 if actor is not null then
 insert into prompt_templates(name,category,instructions,created_by) values
 ('よくある疑問に答える','疑問・Q&A','保護者が習い事選びで感じる一般的な疑問を一つ取り上げ、問いとヒントの形で答えてください。料金・年齢・教室の対応など個別情報は確認済みの場合だけ記載し、不明な点は公式案内で確認するよう伝えてください。',actor),
 ('家庭での見守りのヒント','親子・見守り','子どもの興味を聞く、挑戦した気持ちを受け止めるなど、家庭での声かけや見守りのヒントを一つ伝えてください。危険な運動の手順、医学的・発達上の効果の断言、架空の親子のエピソードは使わないでください。',actor),
 ('地域と教室のお知らせ','地域・お知らせ','段原周辺で教室を探す保護者に向け、確認済みの場所・校舎名・公式ページを自然に案内してください。イベント、空き枠、地域の評判、キャンペーンを創作しないでください。伝えたいお知らせが未設定なら教室を知るための一般的な案内にしてください。',actor);
 end if;
end $$;
commit;
