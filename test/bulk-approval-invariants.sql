begin;
do $$
declare actor uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); duplicate_id uuid:=gen_random_uuid(); past_id uuid:=gen_random_uuid(); undated uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); ids uuid[]; v integer[]; result jsonb; audit_count bigint; base timestamptz:='2060-04-01 08:00+09';
begin
 select user_id into actor from members where active and role='admin' limit 1;
 insert into posts(id,created_by,body,topic,scheduled_at) values
 (a,actor,'一括承認検証A','一括承認検証',base),(b,actor,'一括承認検証B','一括承認検証',base+interval '1 hour'),
 (duplicate_id,actor,'重複時刻の検証','一括承認検証',base),(past_id,actor,'過去時刻の検証','一括承認検証',now()-interval '1 minute'),(undated,actor,'日時未指定の検証','一括承認検証',null);
 result:=preview_bulk_approval(actor,100,'2060-04-01');
 if exists(select 1 from jsonb_array_elements(result->'candidates') p where (p->>'id')::uuid in(past_id,undated)) then raise exception 'invalid schedule in preview';end if;
 if not exists(select 1 from jsonb_array_elements(result->'candidates') p where (p->>'id')::uuid in(a,duplicate_id) and p->>'reason'='同じ時刻の投稿と重複') then raise exception 'duplicate slot not excluded';end if;
 if exists(select 1 from jsonb_array_elements(preview_bulk_approval(actor,100,'2059-12-31')->'candidates') p where (p->>'id')::uuid in(a,b)) then raise exception 'date end not respected';end if;
 select count(*) into audit_count from audit_log;
 begin perform approve_bulk_posts(actor,gen_random_uuid(),array[a,b],array[1,99]);raise exception 'stale version accepted';
 exception when raise_exception then if sqlerrm<>'selection changed' then raise;end if;end;
 if exists(select 1 from posts where id in(a,b) and status<>'draft') or (select count(*) from audit_log)<>audit_count then raise exception 'partial approval committed';end if;
 result:=approve_bulk_posts(actor,req,array[a,b],array[1,1]);
 if result->>'approved'<>'2' or (select count(*) from posts where id in(a,b) and status='scheduled' and approved_by=actor and version=2)<>2 then raise exception 'approval failed';end if;
 result:=approve_bulk_posts(actor,req,array[a,b],array[1,1]);
 if result->>'replayed'<>'true' or (select count(*) from audit_log)<>audit_count+2 then raise exception 'replay duplicated approval';end if;
 begin perform approve_bulk_posts(actor,req,array[a],array[1]);raise exception 'changed replay allowed';exception when raise_exception then if sqlerrm<>'request changed' then raise;end if;end;
 insert into posts(created_by,body,topic,scheduled_at) select actor,'日次上限検証'||i,'日次上限検証',base+i*interval '1 hour' from generate_series(2,7) i;
 select array_agg(id order by scheduled_at),array_agg(version order by scheduled_at) into ids,v from posts where topic='日次上限検証' and created_by=actor;
 begin perform approve_bulk_posts(actor,gen_random_uuid(),ids,v);raise exception 'daily limit ignored';exception when raise_exception then if sqlerrm<>'daily limit' then raise;end if;end;
 if exists(select 1 from posts where id=any(ids) and status<>'draft') then raise exception 'daily limit left partial changes';end if;
 begin perform approve_bulk_posts(gen_random_uuid(),gen_random_uuid(),array[a],array[2]);raise exception 'nonadmin allowed';exception when raise_exception then if sqlerrm<>'admin required' then raise;end if;end;
 insert into posts(created_by,body,scheduled_at) select actor,'100件上限の検証'||i,'2061-01-01 08:00+09'::timestamptz+i*interval '1 minute' from generate_series(1,105) i;
 result:=preview_bulk_approval(actor,100,null);
 if jsonb_array_length(result->'candidates')<>100 or result->>'hasMore'<>'true' then raise exception '100 preview cap failed';end if;
 if has_function_privilege('authenticated','public.approve_bulk_posts(uuid,uuid,uuid[],integer[])','EXECUTE') or has_table_privilege('anon','public.bulk_approval_requests','SELECT') then raise exception 'public access';end if;
end $$;
rollback;
select 'PASS: date/count preview, excluded schedules/duplicates, exact version checks, all-or-nothing approval, replay safety, daily7 limit and admin-only access; all reservations rolled back' as result;
