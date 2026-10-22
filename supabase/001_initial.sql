-- Run once on a new Supabase project. No destructive statements.
begin;
create table public.members (
 user_id uuid primary key references auth.users(id),
 role text not null check(role in ('admin','editor')),
 active boolean not null default true
);
create table public.editorial_settings (
 id bigint generated always as identity primary key,
 content jsonb not null,
 created_by uuid not null references public.members(user_id),
 created_at timestamptz not null default now()
);
create table public.posts (
 id uuid primary key default gen_random_uuid(),
 body text not null check(length(trim(body)) between 1 and 500),
 topic text not null default '',
 scheduled_at timestamptz,
 settings_id bigint references public.editorial_settings(id),
 status text not null default 'draft' check(status in ('draft','scheduled','publishing','published','failed','needs_review')),
 version integer not null default 1,
 approved_by uuid references public.members(user_id),
 created_by uuid not null references public.members(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 claim_id uuid,
 claimed_at timestamptz,
 meta_post_id text unique,
 last_error text,
 check(status='draft' or approved_by is not null),
 check(status not in ('scheduled','publishing') or scheduled_at is not null)
);
create unique index one_post_per_slot on public.posts(scheduled_at)
 where status in ('scheduled','publishing','published');
create table public.metric_snapshots (
 id bigint generated always as identity primary key,
 post_id uuid not null references public.posts(id),
 captured_at timestamptz not null default now(),
 views bigint check(views>=0), likes bigint check(likes>=0),
 replies bigint check(replies>=0), reposts bigint check(reposts>=0),
 quotes bigint check(quotes>=0), shares bigint check(shares>=0)
);
create index metrics_by_post on public.metric_snapshots(post_id,captured_at desc);
create table public.audit_log (
 id bigint generated always as identity primary key,
 actor uuid references public.members(user_id),
 post_id uuid references public.posts(id),
 action text not null,
 created_at timestamptz not null default now()
);
alter table public.members enable row level security;
alter table public.editorial_settings enable row level security;
alter table public.posts enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.audit_log enable row level security;
-- Browser roles have no table grants. Worker validates Auth + active member,
-- then uses the service-role key. No secret key is delivered to the browser.
revoke all on public.members,public.editorial_settings,public.posts,public.metric_snapshots,public.audit_log from anon,authenticated;
grant all on public.members,public.editorial_settings,public.posts,public.metric_snapshots,public.audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;

create function public.mutate_post(p_actor uuid,p_action text,p_id uuid,p_version integer,p_body text default null,p_topic text default '',p_at timestamptz default null,p_settings bigint default null)
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
     if (select count(*) from posts where status in ('scheduled','publishing','published') and (scheduled_at at time zone 'Asia/Tokyo')::date=(p.scheduled_at at time zone 'Asia/Tokyo')::date)>=3 then raise exception 'daily limit'; end if;
     -- Serialize approvals across different posts for the same date.
     perform pg_advisory_xact_lock(hashtext((p.scheduled_at at time zone 'Asia/Tokyo')::date::text));
     if (select count(*) from posts where status in ('scheduled','publishing','published') and (scheduled_at at time zone 'Asia/Tokyo')::date=(p.scheduled_at at time zone 'Asia/Tokyo')::date)>=3 then raise exception 'daily limit'; end if;
     update posts set status='scheduled',approved_by=p_actor,version=version+1,updated_at=now() where id=p_id returning * into p;
   elsif p_action='cancel' then
     if m.role<>'admin' or p.status<>'scheduled' then raise exception 'forbidden'; end if;
     update posts set status='draft',approved_by=null,version=version+1,updated_at=now() where id=p_id returning * into p;
   else raise exception 'unknown action'; end if;
 end if;
 insert into audit_log(actor,post_id,action) values(p_actor,p.id,p_action);
 return p;
end $$;

create function public.claim_due_post() returns setof public.posts language plpgsql security definer set search_path=public as $$
begin
 -- Never automatically re-publish an uncertain result.
 update posts set status='needs_review',last_error='公開結果の照合が必要です',version=version+1,updated_at=now()
 where status='publishing' and claimed_at<now()-interval '15 minutes';
 -- Do not publish stale queued posts in a burst after an outage.
 update posts set status='needs_review',last_error='予約時刻から15分以上経過しています',version=version+1,updated_at=now()
 where status='scheduled' and scheduled_at<now()-interval '15 minutes';
 return query update posts set status='publishing',claim_id=gen_random_uuid(),claimed_at=now(),version=version+1,updated_at=now()
 where id=(select id from posts where status='scheduled' and scheduled_at<=now() order by scheduled_at for update skip locked limit 1)
 returning *;
end $$;
revoke all on function public.mutate_post(uuid,text,uuid,integer,text,text,timestamptz,bigint) from public,anon,authenticated;
revoke all on function public.claim_due_post() from public,anon,authenticated;
grant execute on function public.mutate_post(uuid,text,uuid,integer,text,text,timestamptz,bigint) to service_role;
grant execute on function public.claim_due_post() to service_role;
commit;
