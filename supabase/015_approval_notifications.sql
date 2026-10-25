begin;
create table public.approval_notification_settings (
 id integer primary key check(id=1),enabled boolean not null default false,recipient text not null default 'hasegawa@ka-ku-do.com',skip_dates date[] not null default '{}',version integer not null default 1,last_checked_at timestamptz
);
insert into public.approval_notification_settings(id) values(1);
create table public.approval_notifications (
 id uuid primary key default gen_random_uuid(),dedupe_key text not null unique,target_date date not null,slot integer check(slot in(12,18)),kind text not null check(kind in('alert','test')),
 recipient text not null,status text not null check(status in('pending','sending','sent','unknown','cancelled')),claim_id uuid,created_at timestamptz not null default now(),claimed_at timestamptz,sent_at timestamptz,message_id text
);
alter table public.approval_notification_settings enable row level security;
alter table public.approval_notifications enable row level security;
revoke all on public.approval_notification_settings,public.approval_notifications from public,anon,authenticated;
grant all on public.approval_notification_settings,public.approval_notifications to service_role;
create function public.save_approval_notifications(p_actor uuid,p_version integer,p_enabled boolean,p_recipient text,p_skip date[]) returns public.approval_notification_settings
language plpgsql security definer set search_path=public as $$
declare s public.approval_notification_settings;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 if p_enabled is null or p_recipient is null or p_recipient!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_recipient)>254 or p_skip is null or cardinality(p_skip)>100 then raise exception 'invalid settings';end if;
 update approval_notification_settings set enabled=p_enabled,recipient=p_recipient,skip_dates=p_skip,version=version+1 where id=1 and version=p_version returning * into s;
 if not found then raise exception 'settings changed';end if;
 return s;
end $$;
create function public.request_approval_notification_test(p_actor uuid,p_request uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 perform pg_advisory_xact_lock(hashtext('approval-notification-test'));
 select id into result from approval_notifications where dedupe_key='test:'||p_request::text;if found then return result;end if;
 if p_request is null or exists(select 1 from approval_notifications where kind='test' and created_at>now()-interval '1 minute') then raise exception 'wait a minute';end if;
 insert into approval_notifications(dedupe_key,target_date,kind,recipient,status) select 'test:'||p_request::text,(now() at time zone 'Asia/Tokyo')::date+1,'test',recipient,'pending' from approval_notification_settings where id=1 returning id into result;
 return result;
end $$;
create function public.claim_approval_notification(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.approval_notification_settings;n public.approval_notifications;day date:=(p_now at time zone 'Asia/Tokyo')::date+1;hour integer:=extract(hour from p_now at time zone 'Asia/Tokyo');key text;
begin
 perform pg_advisory_xact_lock(hashtext('approval-notification-claim'));
 select * into s from approval_notification_settings where id=1 for update;
 update approval_notification_settings set last_checked_at=p_now where id=1;
 update approval_notifications set status='unknown' where status='sending' and claimed_at<p_now-interval '30 minutes';
 update approval_notifications set status='cancelled' where kind='test' and status='pending' and created_at<p_now-interval '24 hours';
 select * into n from approval_notifications where kind='test' and status='pending' order by created_at for update skip locked limit 1;
 if n.id is null then
  if not s.enabled or hour not in(12,18) or day=any(s.skip_dates) then return null;end if;
  if exists(select 1 from posts where deleted_at is null and approved_by is not null and status in('scheduled','publishing','published') and scheduled_at>=(day::timestamp at time zone 'Asia/Tokyo') and scheduled_at<((day+1)::timestamp at time zone 'Asia/Tokyo')) then return null;end if;
  key:=day::text||':'||hour::text;
  insert into approval_notifications(dedupe_key,target_date,slot,kind,recipient,status) values(key,day,hour,'alert',s.recipient,'pending') on conflict(dedupe_key) do nothing returning * into n;
  if n.id is null then return null;end if;
 end if;
 update approval_notifications set status='sending',claim_id=gen_random_uuid(),claimed_at=p_now where id=n.id returning * into n;
 return to_jsonb(n);
end $$;
create function public.complete_approval_notification(p_id uuid,p_claim uuid,p_message text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_message is null or length(p_message) not between 1 and 200 then raise exception 'message id required';end if;
 update approval_notifications set status='sent',sent_at=coalesce(sent_at,now()),message_id=p_message where id=p_id and claim_id=p_claim and status in('sending','unknown','sent');
 return found;
end $$;
revoke all on function public.save_approval_notifications(uuid,integer,boolean,text,date[]),public.request_approval_notification_test(uuid,uuid),public.claim_approval_notification(timestamptz),public.complete_approval_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_approval_notifications(uuid,integer,boolean,text,date[]),public.request_approval_notification_test(uuid,uuid),public.claim_approval_notification(timestamptz),public.complete_approval_notification(uuid,uuid,text) to service_role;
commit;
