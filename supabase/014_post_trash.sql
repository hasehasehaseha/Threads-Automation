begin;
alter table public.posts add column deleted_at timestamptz;
create function public.protect_trashed_post() returns trigger language plpgsql set search_path=public as $$
begin
 if old.deleted_at is not null and new.deleted_at is not null then raise exception 'post in trash';end if;
 return new;
end $$;
create trigger protect_trashed_post before update on public.posts for each row execute function public.protect_trashed_post();
create function public.trash_post(p_actor uuid,p_id uuid,p_version integer,p_restore boolean default false) returns public.posts
language plpgsql security definer set search_path=public as $$
declare p public.posts;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 select * into p from posts where id=p_id for update;
 if not found or p.version<>p_version then raise exception 'post changed';end if;
 if p_restore then
  if p.deleted_at is null then raise exception 'not in trash';end if;
  update posts set deleted_at=null,status='draft',approved_by=null,version=version+1,updated_at=now() where id=p_id returning * into p;
 else
  if p.deleted_at is not null or p.status not in ('draft','scheduled') then raise exception 'cannot trash this post';end if;
  update posts set deleted_at=now(),status='draft',approved_by=null,version=version+1,updated_at=now() where id=p_id returning * into p;
 end if;
 insert into audit_log(actor,post_id,action) values(p_actor,p_id,case when p_restore then 'restore' else 'trash' end);
 return p;
end $$;
revoke all on function public.trash_post(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.trash_post(uuid,uuid,integer,boolean) to service_role;
-- Definitions below retain existing safeguards and omit trashed drafts from previews/history.

create or replace function public.preview_bulk_approval(p_actor uuid,p_limit integer,p_end date default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.posts; result jsonb:='[]'; used jsonb:='{}'; clocks timestamptz[]:='{}'; day text; reason text; taken integer; picked integer; n integer:=0; more boolean:=false;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_end is not null and p_end<(now() at time zone 'Asia/Tokyo')::date) then raise exception 'invalid limit';end if;
 for p in select * from posts where deleted_at is null and status='draft' and scheduled_at>now()
 and (p_end is null or scheduled_at<((p_end+1)::timestamp at time zone 'Asia/Tokyo'))
 order by scheduled_at,created_at,id limit p_limit+1 loop
  n:=n+1;if n>p_limit then more:=true;exit;end if;
  day:=(p.scheduled_at at time zone 'Asia/Tokyo')::date::text;reason:=null;
  select count(*) into taken from posts where status in ('scheduled','publishing','published') and (scheduled_at at time zone 'Asia/Tokyo')::date=day::date;
  picked:=coalesce((used->>day)::integer,0);
  if exists(select 1 from posts where status in ('scheduled','publishing','published') and scheduled_at=p.scheduled_at) or p.scheduled_at=any(clocks) then reason:='同じ時刻の投稿と重複';
  elsif taken+picked>=7 then reason:='1日7件の上限';end if;
  if reason is null then used:=jsonb_set(used,array[day],to_jsonb(picked+1));clocks:=array_append(clocks,p.scheduled_at);end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',p.id,'version',p.version,'body',p.body,'topic',p.topic,'scheduled_at',p.scheduled_at,'reason',reason));
 end loop;
 return jsonb_build_object('candidates',result,'hasMore',more,'limit',p_limit);
end $$;
create or replace function public.history_for_generation(p_date date) returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.day desc,p.id),'[]') from (
 select id,body,topic,status,coalesce((scheduled_at at time zone 'Asia/Tokyo')::date,(created_at at time zone 'Asia/Tokyo')::date) as day
 from posts where deleted_at is null and status in ('draft','scheduled','publishing','published','failed','needs_review')
 and coalesce((scheduled_at at time zone 'Asia/Tokyo')::date,(created_at at time zone 'Asia/Tokyo')::date) between p_date-60 and p_date+7
 order by coalesce(scheduled_at,created_at) desc,id limit 1500
 ) p;
$$;
commit;
