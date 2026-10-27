begin;
create table public.bulk_trash_requests (
 id uuid primary key,actor uuid not null references public.members(user_id),post_ids uuid[] not null,versions integer[] not null,created_at timestamptz not null default now()
);
alter table public.bulk_trash_requests enable row level security;
revoke all on public.bulk_trash_requests from public,anon,authenticated;
grant all on public.bulk_trash_requests to service_role;
create function public.trash_drafts_bulk(p_actor uuid,p_request uuid,p_ids uuid[],p_versions integer[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prior public.bulk_trash_requests;p public.posts;n integer;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required';end if;
 n:=cardinality(p_ids);
 if p_request is null or n is null or n not between 1 and 100 or cardinality(p_versions) is distinct from n
 or exists(select 1 from unnest(p_ids) x where x is null) or exists(select 1 from unnest(p_versions) v where v is null or v<1)
 or (select count(distinct x) from unnest(p_ids) x)<>n then raise exception 'invalid selection';end if;
 perform pg_advisory_xact_lock(hashtext('bulk-trash:'||p_request::text));
 select * into prior from bulk_trash_requests where id=p_request;
 if prior.id is not null then
  if prior.actor<>p_actor or prior.post_ids<>p_ids or prior.versions<>p_versions then raise exception 'request changed';end if;
  return jsonb_build_object('moved',n,'replayed',true);
 end if;
 perform 1 from posts where id=any(p_ids) order by id for update;
 if (select count(*) from posts where id=any(p_ids))<>n then raise exception 'selection changed';end if;
 for p in select * from posts where id=any(p_ids) order by id loop
  if p.status<>'draft' or p.deleted_at is not null or p.version<>p_versions[array_position(p_ids,p.id)] then raise exception 'selection changed';end if;
  perform public.trash_post(p_actor,p.id,p.version,false);
 end loop;
 insert into bulk_trash_requests(id,actor,post_ids,versions) values(p_request,p_actor,p_ids,p_versions);
 return jsonb_build_object('moved',n,'replayed',false);
end $$;
revoke all on function public.trash_drafts_bulk(uuid,uuid,uuid[],integer[]) from public,anon,authenticated;
grant execute on function public.trash_drafts_bulk(uuid,uuid,uuid[],integer[]) to service_role;
commit;
