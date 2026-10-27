begin;
do $$
declare actor uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();req uuid:=gen_random_uuid();r jsonb;p public.posts;base_count bigint;
begin
 select user_id into actor from members where active and role='admin' limit 1;
 insert into posts(id,created_by,body,scheduled_at) values(a,actor,'一括ごみ箱の検証A','2068-04-01 08:00+09'),(b,actor,'一括ごみ箱の検証B',null),(c,actor,'予約済み除外の検証','2068-04-01 10:00+09');
 select count(*) into base_count from audit_log;
 begin perform trash_drafts_bulk(actor,gen_random_uuid(),array[a,b],array[1,99]);raise exception 'stale accepted';exception when raise_exception then if sqlerrm<>'selection changed' then raise;end if;end;
 if exists(select 1 from posts where id in(a,b) and deleted_at is not null) or (select count(*) from audit_log)<>base_count then raise exception 'partial trash';end if;
 r:=trash_drafts_bulk(actor,req,array[a,b],array[1,1]);
 if r->>'moved' is distinct from '2' or (select count(*) from posts where id in(a,b) and deleted_at is not null and status='draft' and version=2)<>2 then raise exception 'trash failed';end if;
 r:=trash_drafts_bulk(actor,req,array[a,b],array[1,1]);if r->>'replayed' is distinct from 'true' or (select count(*) from audit_log)<>base_count+2 then raise exception 'duplicate writes';end if;
 p:=trash_post(actor,a,2,true);perform trash_drafts_bulk(actor,req,array[a,b],array[1,1]);
 if (select deleted_at from posts where id=a) is not null then raise exception 'replay deleted restored post';end if;
 perform mutate_post(actor,'approve',c,1);
 begin perform trash_drafts_bulk(actor,gen_random_uuid(),array[a,c],array[3,2]);raise exception 'scheduled accepted';exception when raise_exception then if sqlerrm<>'selection changed' then raise;end if;end;
 if (select deleted_at from posts where id=a) is not null or (select status from posts where id=c)<>'scheduled' then raise exception 'scheduled batch partial change';end if;
 begin perform trash_drafts_bulk(gen_random_uuid(),gen_random_uuid(),array[a],array[3]);raise exception 'nonadmin allowed';exception when raise_exception then if sqlerrm<>'admin required' then raise;end if;end;
 begin perform trash_drafts_bulk(actor,gen_random_uuid(),array[a,a],array[3,3]);raise exception 'duplicates allowed';exception when raise_exception then if sqlerrm<>'invalid selection' then raise;end if;end;
 begin perform trash_drafts_bulk(actor,gen_random_uuid(),array[a],array[null::integer]);raise exception 'null version';exception when raise_exception then if sqlerrm<>'invalid selection' then raise;end if;end;
 if has_function_privilege('authenticated','public.trash_drafts_bulk(uuid,uuid,uuid[],integer[])','EXECUTE') or has_table_privilege('anon','public.bulk_trash_requests','SELECT') then raise exception 'public access';end if;
end $$;
rollback;
select 'PASS: atomic draft-only trash, version conflict rollback, replay safety including restored drafts, reserved post rejection, admin/duplicate/null/ACL checks; all changes rolled back' as result;
