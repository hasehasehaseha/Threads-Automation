begin;
create function public.claim_immediate_post(p_actor uuid,p_id uuid,p_version integer)
returns public.posts language plpgsql security definer set search_path=public as $$
declare p public.posts; today date;
begin
 if not exists(select 1 from members where user_id=p_actor and active and role='admin') then raise exception 'admin required'; end if;
 select * into p from posts where id=p_id for update;
 if not found or p.version<>p_version or p.status not in ('draft','scheduled') then raise exception 'post changed or already claimed'; end if;
 today:=(now() at time zone 'Asia/Tokyo')::date;
 perform pg_advisory_xact_lock(hashtext(today::text));
 if (select count(*) from posts where id<>p_id and status in ('scheduled','publishing','published','needs_review')
 and (scheduled_at at time zone 'Asia/Tokyo')::date=today)>=3 then raise exception 'daily limit'; end if;
 update posts set status='publishing',scheduled_at=clock_timestamp(),approved_by=p_actor,
 claim_id=gen_random_uuid(),claimed_at=now(),version=version+1,updated_at=now()
 where id=p_id returning * into p;
 insert into audit_log(actor,post_id,action) values(p_actor,p_id,'publish_now');
 return p;
end $$;
revoke all on function public.claim_immediate_post(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_immediate_post(uuid,uuid,integer) to service_role;
commit;
