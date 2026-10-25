begin;
create table public.bulk_approval_requests (
 id uuid primary key, actor uuid not null references public.members(user_id),
 post_ids uuid[] not null, versions integer[] not null, created_at timestamptz not null default now()
);
alter table public.bulk_approval_requests enable row level security;
revoke all on public.bulk_approval_requests from public,anon,authenticated;
grant all on public.bulk_approval_requests to service_role;
create function public.preview_bulk_approval(p_actor uuid,p_limit integer,p_end date default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.posts; result jsonb:='[]'; used jsonb:='{}'; clocks timestamptz[]:='{}'; day text; reason text; taken integer; picked integer; n integer:=0; more boolean:=false;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_end is not null and p_end<(now() at time zone 'Asia/Tokyo')::date) then raise exception 'invalid limit';end if;
 for p in select * from posts where status='draft' and scheduled_at>now()
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
create function public.approve_bulk_posts(p_actor uuid,p_request uuid,p_ids uuid[],p_versions integer[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prior public.bulk_approval_requests; p public.posts; n integer;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 n:=cardinality(p_ids);
 if p_request is null or n is null or n not between 1 and 100 or cardinality(p_versions) is distinct from n
 or exists(select 1 from unnest(p_ids) x where x is null) or exists(select 1 from unnest(p_versions) v where v is null or v<1)
 or (select count(distinct x) from unnest(p_ids) x)<>n then raise exception 'invalid selection';end if;
 perform pg_advisory_xact_lock(hashtext('bulk-approval:'||p_request::text));
 select * into prior from bulk_approval_requests where id=p_request;
 if prior.id is not null then
  if prior.actor<>p_actor or prior.post_ids<>p_ids or prior.versions<>p_versions then raise exception 'request changed';end if;
  return jsonb_build_object('approved',n,'ids',p_ids,'replayed',true);
 end if;
 -- Lock all selected rows in a consistent order before the existing per-date approval locks.
 perform 1 from posts where id=any(p_ids) order by id for update;
 if (select count(*) from posts where id=any(p_ids))<>n then raise exception 'selection changed';end if;
 for p in select * from posts where id=any(p_ids) order by scheduled_at,id loop
  if p.status<>'draft' or p.version<>p_versions[array_position(p_ids,p.id)] or p.scheduled_at is null or p.scheduled_at<=now() then raise exception 'selection changed';end if;
  perform public.mutate_post(p_actor,'approve',p.id,p.version);
 end loop;
 insert into bulk_approval_requests(id,actor,post_ids,versions) values(p_request,p_actor,p_ids,p_versions);
 return jsonb_build_object('approved',n,'ids',p_ids,'replayed',false);
end $$;
revoke all on function public.preview_bulk_approval(uuid,integer,date),public.approve_bulk_posts(uuid,uuid,uuid[],integer[]) from public,anon,authenticated;
grant execute on function public.preview_bulk_approval(uuid,integer,date),public.approve_bulk_posts(uuid,uuid,uuid[],integer[]) to service_role;
commit;
