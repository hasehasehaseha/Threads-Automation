begin;
create table public.ai_config (
 id smallint primary key default 1 check(id=1),
 model text not null default 'gpt-6.1-sol' check(model in ('gpt-6.1-sol','gpt-6-luna')),
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.ai_config(id) values(1);
create table public.ai_usage (
 id uuid primary key, job_id uuid not null references public.generation_jobs(id),
 kind text not null check(kind in ('production','test')), model text not null,
 purpose text not null, status text not null default 'reserved' check(status in ('reserved','recorded','unknown')),
 input_tokens bigint, output_tokens bigint, cached_tokens bigint,
 reserved_usd numeric not null check(reserved_usd>=0), cost_usd numeric,
 created_at timestamptz not null default now(), completed_at timestamptz,
 check(input_tokens is null or input_tokens>=0), check(output_tokens is null or output_tokens>=0),
 check(cost_usd is null or cost_usd>=0)
);
create index ai_usage_month on public.ai_usage(created_at,kind);
create table public.post_memory (
 post_id uuid primary key references public.posts(id),
 body_hash text not null, embedding jsonb not null, memo jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
alter table public.generation_jobs add column ai_report jsonb;
alter table public.ai_config enable row level security;
alter table public.ai_usage enable row level security;
alter table public.post_memory enable row level security;
revoke all on public.ai_config,public.ai_usage,public.post_memory from public,anon,authenticated;
grant all on public.ai_config,public.ai_usage,public.post_memory to service_role;

create function public.ai_month_usage() returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object(
 'month',to_char(now() at time zone 'Asia/Tokyo','YYYY-MM'),
 'productionUsd',coalesce(sum(coalesce(cost_usd,reserved_usd)) filter(where kind='production'),0),
 'testUsd',coalesce(sum(coalesce(cost_usd,reserved_usd)) filter(where kind='test'),0),
 'inputTokens',coalesce(sum(input_tokens),0),'outputTokens',coalesce(sum(output_tokens),0),
 'unknownCalls',count(*) filter(where status<>'recorded'), 'budgetUsd',20,
 'pricingDate','2026-10-25') from ai_usage
 where created_at>=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
$$;
create function public.reserve_ai_call(p_id uuid,p_job uuid,p_model text,p_purpose text,p_reserve numeric) returns boolean
language plpgsql security definer set search_path=public as $$
declare j public.generation_jobs; used numeric;
begin
 if p_reserve is null or p_reserve<0 or p_reserve>5 then raise exception 'invalid reserve'; end if;
 perform pg_advisory_xact_lock(hashtext('ai-month-budget'));
 select * into j from generation_jobs where id=p_job;
 if j.id is null or j.status<>'generating' or not exists(select 1 from members where user_id=j.created_by and active) then raise exception 'invalid generation'; end if;
 if exists(select 1 from ai_usage where id=p_id) then return false;end if;
 select coalesce(sum(coalesce(cost_usd,reserved_usd)),0) into used from ai_usage
 where kind='production' and created_at>=date_trunc('month',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
 if j.kind='production' and used+p_reserve>20 then raise exception 'monthly production budget reached'; end if;
 insert into ai_usage(id,job_id,kind,model,purpose,reserved_usd) values(p_id,p_job,j.kind,p_model,p_purpose,p_reserve);
 return true;
end $$;
create function public.history_for_generation(p_date date) returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.day desc,p.id),'[]') from (
 select id,body,topic,status,coalesce((scheduled_at at time zone 'Asia/Tokyo')::date,(created_at at time zone 'Asia/Tokyo')::date) as day
 from posts where status in ('draft','scheduled','publishing','published','failed','needs_review')
 and coalesce((scheduled_at at time zone 'Asia/Tokyo')::date,(created_at at time zone 'Asia/Tokyo')::date) between p_date-60 and p_date+7
 order by coalesce(scheduled_at,created_at) desc,id limit 1500
 ) p;
$$;
create function public.save_ai_config(p_actor uuid,p_version integer,p_model text) returns public.ai_config
language plpgsql security definer set search_path=public as $$
declare c public.ai_config;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 select * into c from ai_config where id=1 for update;
 if c.version is distinct from p_version then raise exception 'settings changed; reload';end if;
 update ai_config set model=p_model,version=version+1,updated_at=now() where id=1 returning * into c;return c;
end $$;
revoke all on function public.ai_month_usage(),public.reserve_ai_call(uuid,uuid,text,text,numeric),public.history_for_generation(date),public.save_ai_config(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.ai_month_usage(),public.reserve_ai_call(uuid,uuid,text,text,numeric),public.history_for_generation(date),public.save_ai_config(uuid,integer,text) to service_role;
commit;
