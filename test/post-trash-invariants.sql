begin;
do $$
declare actor uuid; p public.posts; id uuid:=gen_random_uuid(); r jsonb;
begin
 select user_id into actor from members where active and role='admin' limit 1;
 insert into posts(id,created_by,body,scheduled_at) values(id,actor,'ごみ箱動作検証',now()+interval '1 day') returning * into p;
 p:=mutate_post(actor,'approve',p.id,p.version);
 p:=trash_post(actor,p.id,p.version,false);
 if p.deleted_at is null or p.status<>'draft' or p.approved_by is not null then raise exception 'trash failed';end if;
 begin perform mutate_post(actor,'approve',p.id,p.version);raise exception 'trashed post approved';exception when raise_exception then if sqlerrm<>'post in trash' then raise;end if;end;
 begin perform claim_immediate_post(actor,p.id,p.version);raise exception 'trashed post claimed';exception when raise_exception then if sqlerrm<>'post in trash' then raise;end if;end;
 r:=preview_bulk_approval(actor,100,null);
 if exists(select 1 from jsonb_array_elements(r->'candidates') x where x->>'id'=p.id::text) then raise exception 'trash in preview';end if;
 r:=history_for_generation((now() at time zone 'Asia/Tokyo')::date);
 if exists(select 1 from jsonb_array_elements(r) x where x->>'id'=p.id::text) then raise exception 'trash in AI history';end if;
 begin perform trash_post(gen_random_uuid(),p.id,p.version,true);raise exception 'nonadmin restored';exception when raise_exception then if sqlerrm<>'admin required' then raise;end if;end;
 begin perform trash_post(actor,p.id,1,true);raise exception 'stale restore';exception when raise_exception then if sqlerrm<>'post changed' then raise;end if;end;
 p:=trash_post(actor,p.id,p.version,true);
 if p.deleted_at is not null or p.status<>'draft' or p.approved_by is not null then raise exception 'restore failed';end if;
 if has_function_privilege('authenticated','public.trash_post(uuid,uuid,integer,boolean)','EXECUTE') then raise exception 'public access';end if;
end $$;
rollback;
select 'PASS: trash cancels reservation, blocks publishing and bulk approval, excludes AI history, restores draft, enforces version/admin; all changes rolled back' as result;
