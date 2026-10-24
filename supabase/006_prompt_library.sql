begin;
create table public.prompt_templates (
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 100),
 category text not null check(length(trim(category)) between 1 and 60),
 instructions text not null check(length(trim(instructions)) between 1 and 6000),active boolean not null default true,
 version integer not null default 1,created_by uuid not null references public.members(user_id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.prompt_plan (
 id smallint primary key default 1 check(id=1),slots uuid[] not null check(cardinality(slots)=3),
 version integer not null default 1,updated_by uuid not null references public.members(user_id),updated_at timestamptz not null default now()
);
alter table public.prompt_templates enable row level security;
alter table public.prompt_plan enable row level security;
revoke all on public.prompt_templates,public.prompt_plan from public,anon,authenticated;
grant all on public.prompt_templates,public.prompt_plan to service_role;
alter table public.generation_jobs alter column target_date drop not null;
alter table public.generation_jobs add column kind text not null default 'production' check(kind in ('production','test'));
alter table public.generation_jobs add column prompt_snapshot jsonb;
alter table public.generation_jobs add column preview_posts jsonb;
alter table public.generation_jobs add constraint generation_job_target check((kind='test' and target_date is null) or (kind='production' and target_date is not null));

create function public.save_prompt_template(p_actor uuid,p_id uuid,p_version integer,p_content jsonb)
returns public.prompt_templates language plpgsql security definer set search_path=public as $$
declare t public.prompt_templates;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required'; end if;
 if p_id is null then
 insert into prompt_templates(name,category,instructions,active,created_by) values(p_content->>'name',p_content->>'category',p_content->>'instructions',(p_content->>'active')::boolean,p_actor) returning * into t;
 else
 update prompt_templates set name=p_content->>'name',category=p_content->>'category',instructions=p_content->>'instructions',active=(p_content->>'active')::boolean,version=version+1,updated_at=now()
 where id=p_id and version=p_version returning * into t;
 if t.id is null then raise exception 'prompt changed; reload'; end if;
 end if;
 return t;
end $$;
create function public.save_prompt_plan(p_actor uuid,p_version integer,p_slots uuid[])
returns public.prompt_plan language plpgsql security definer set search_path=public as $$
declare plan public.prompt_plan; slot uuid;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required'; end if;
 if cardinality(p_slots)<>3 then raise exception 'three slots required'; end if;
 foreach slot in array p_slots loop
 if not exists(select 1 from prompt_templates where id=slot and active) then raise exception 'active prompt required'; end if;
 end loop;
 select * into plan from prompt_plan where id=1 for update;
 if plan.id is null then
 insert into prompt_plan(slots,updated_by) values(p_slots,p_actor) returning * into plan;
 else
 if plan.version is distinct from p_version then raise exception 'plan changed; reload'; end if;
 update prompt_plan set slots=p_slots,version=version+1,updated_by=p_actor,updated_at=now() where id=1 returning * into plan;
 end if;
 return plan;
end $$;

create or replace function public.request_generation_job(p_actor uuid) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs; target date; selected jsonb;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden'; end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first'; end if;
 target:=(now() at time zone 'Asia/Tokyo')::date+1;
 select * into j from generation_jobs where target_date=target;
 if j.id is not null then return j; end if;
 select jsonb_agg(jsonb_build_object('id',t.id,'version',t.version,'name',t.name,'category',t.category,'instructions',t.instructions) order by u.n) into selected
 from prompt_plan p cross join lateral unnest(p.slots) with ordinality u(id,n) join prompt_templates t on t.id=u.id and t.active where p.id=1;
 if selected is null or jsonb_array_length(selected)<>3 then raise exception 'configure three active prompts'; end if;
 insert into generation_jobs(created_by,settings_id,settings_snapshot,target_date,prompt_snapshot)
 values(p_actor,s.id,s.content,target,jsonb_build_object('mode','production','templates',selected)) on conflict(target_date) do nothing returning * into j;
 if j.id is null then select * into j from generation_jobs where target_date=target; end if;
 return j;
end $$;

create function public.request_prompt_test(p_actor uuid,p_snapshot jsonb) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare s public.editorial_settings; j public.generation_jobs;
begin
 if not exists(select 1 from members where user_id=p_actor and active) then raise exception 'forbidden'; end if;
 perform pg_advisory_xact_lock(hashtext('prompt-test:'||p_actor::text));
 if (select count(*) from generation_jobs where created_by=p_actor and kind='test' and created_at>now()-interval '1 hour')>=10 then raise exception 'test limit; wait one hour'; end if;
 select * into j from generation_jobs where created_by=p_actor and kind='test' and status in ('queued','generating') and created_at>now()-interval '20 minutes' order by created_at desc limit 1;
 if j.id is not null then raise exception 'test running; wait for result'; end if;
 select * into s from editorial_settings order by id desc limit 1;
 if s.id is null then raise exception 'save settings first'; end if;
 insert into generation_jobs(created_by,settings_id,settings_snapshot,target_date,kind,prompt_snapshot)
 values(p_actor,s.id,s.content,null,'test',p_snapshot) returning * into j;
 return j;
end $$;

create or replace function public.complete_generation_job(p_id uuid,p_claim uuid,p_posts jsonb) returns public.generation_jobs
language plpgsql security definer set search_path=public as $$
declare j public.generation_jobs; entry jsonb; post_id uuid; ids uuid[]:='{}'; slot time; n integer:=0;
begin
 select * into j from generation_jobs where id=p_id for update;
 if j.id is null or j.claim_id is distinct from p_claim or p_claim is null then raise exception 'invalid claim'; end if;
 if j.status='completed' then return j; end if;
 if j.status not in ('generating','needs_review') then raise exception 'invalid status'; end if;
 if not exists(select 1 from members where user_id=j.created_by and active) then raise exception 'forbidden'; end if;
 if jsonb_typeof(p_posts)<>'array' or jsonb_array_length(p_posts)<>3 then raise exception 'three drafts required'; end if;
 for entry in select * from jsonb_array_elements(p_posts) loop
 if jsonb_typeof(entry->'body') is distinct from 'string' or jsonb_typeof(entry->'topic') is distinct from 'string'
 or length(trim(entry->>'body')) not between 1 and 500 or length(trim(entry->>'topic')) not between 1 and 100 then raise exception 'invalid draft'; end if;
 end loop;
 if j.kind='test' then
 update generation_jobs set status='completed',completed_at=now(),preview_posts=p_posts where id=p_id returning * into j;
 return j;
 end if;
 for entry in select * from jsonb_array_elements(p_posts) loop
 n:=n+1;slot:=case n when 1 then time '08:00' when 2 then time '12:00' else time '20:00' end;
 insert into posts(body,topic,scheduled_at,settings_id,created_by,status)
 values(entry->>'body',entry->>'topic',(j.target_date+slot) at time zone 'Asia/Tokyo',j.settings_id,j.created_by,'draft') returning id into post_id;
 ids:=array_append(ids,post_id);
 insert into audit_log(actor,post_id,action) values(j.created_by,post_id,'ai_draft');
 end loop;
 update generation_jobs set status='completed',completed_at=now(),post_ids=ids where id=p_id returning * into j;
 return j;
end $$;
revoke all on function public.save_prompt_template(uuid,uuid,integer,jsonb),public.save_prompt_plan(uuid,integer,uuid[]),public.request_prompt_test(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_prompt_template(uuid,uuid,integer,jsonb),public.save_prompt_plan(uuid,integer,uuid[]),public.request_prompt_test(uuid,jsonb) to service_role;

do $$ declare actor uuid; a uuid; b uuid; c uuid; begin
 select user_id into actor from members where active and role='admin' order by user_id limit 1;
 if actor is not null then
 insert into prompt_templates(name,category,instructions,created_by) values('保護者への共感','共感','保護者が習い事選びで感じる迷いや、小さな一歩を見守る気持ちに寄り添ってください。身近な問いかけから始め、焦らせず、読者が自分の気持ちを話したくなる余白を残してください。実在の親子の出来事や教室での発言を作らないでください。',actor) returning id into a;
 insert into prompt_templates(name,category,instructions,created_by) values('習い事選びのヒント','学び','保護者に役立つ、習い事を選ぶときの確認ポイントを一つ伝えてください。例えば子どもの興味を聞く、体験時に質問したいことを整理するなど。冒頭に読者の疑問、続いて具体的なヒント、最後に考えやすい問いかけを入れてください。専門的な運動指導や発達効果、教室固有のサービスを未確認で断言しないでください。',actor) returning id into b;
 insert into prompt_templates(name,category,instructions,created_by) values('教室を知ってもらう','教室紹介','確認済みの校舎名・場所・公式ページを使い、初めて知る保護者に自然な言葉で教室を紹介してください。一つの話題に絞り、押し売りにならない案内で締めてください。公式ページのURLは確認済み情報にある場合だけ記載してください。設備・指導方針・先生の様子は情報がなければ書かないでください。',actor) returning id into c;
 insert into prompt_templates(name,category,instructions,created_by) values('初めての体験前の不安','体験前の安心','初めての習い事を検討する保護者の不安を一つ取り上げてください。一般的な準備や事前に確認したいことを、落ち着いた口調で提案してください。「必ずできる」「人見知りでも安心」などの保証や架空の体験談を使わず、教室の具体的対応は確認済みの場合だけ伝えてください。',actor);
 insert into prompt_plan(slots,updated_by) values(array[a,b,c],actor);
 end if;
end $$;
commit;
