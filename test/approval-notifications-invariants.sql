begin;
do $$
declare actor uuid;n jsonb;fixture_id uuid:=gen_random_uuid();testid uuid;day date:='2080-01-02';
begin
 select user_id into actor from members where active and role='admin' limit 1;
 update approval_notification_settings set enabled=true,recipient='fixture@example.com',skip_dates='{}' where id=1;
 n:=claim_approval_notification('2080-01-01 11:59+09');if n is not null then raise exception 'wrong hour';end if;
 n:=claim_approval_notification('2080-01-01 12:00+09');if n->>'target_date'<>'2080-01-02' or n->>'slot'<>'12' then raise exception 'noon/date';end if;
 if claim_approval_notification('2080-01-01 12:01+09') is not null then raise exception 'duplicate noon';end if;
 if not complete_approval_notification((n->>'id')::uuid,(n->>'claim_id')::uuid,'test-message-id') then raise exception 'result';end if;
 if not complete_approval_notification((n->>'id')::uuid,(n->>'claim_id')::uuid,'test-message-id') then raise exception 'idempotent result';end if;
 insert into posts(id,created_by,body,scheduled_at) values(fixture_id,actor,'通知検証','2080-01-02 08:00+09');
 perform mutate_post(actor,'approve',fixture_id,1);
 if claim_approval_notification('2080-01-01 18:00+09') is not null then raise exception 'approved evening alert';end if;
 perform trash_post(actor,fixture_id,2,false);
 n:=claim_approval_notification('2080-01-01 18:01+09');if n->>'slot'<>'18' then raise exception 'evening zero';end if;
 if claim_approval_notification('2080-01-01 18:02+09') is not null then raise exception 'duplicate evening';end if;
 update approval_notification_settings set skip_dates=array['2080-01-03'::date] where id=1;
 if claim_approval_notification('2080-01-02 12:00+09') is not null then raise exception 'skip date';end if;
 update approval_notification_settings set enabled=false where id=1;
 if claim_approval_notification('2080-01-03 12:00+09') is not null then raise exception 'disabled';end if;
 testid:=request_approval_notification_test(actor,gen_random_uuid());
 n:=claim_approval_notification(now());if n->>'id'<>testid::text or n->>'kind'<>'test' then raise exception 'test while disabled';end if;
 begin perform request_approval_notification_test(gen_random_uuid(),gen_random_uuid());raise exception 'staff test';exception when raise_exception then if sqlerrm<>'admin required' then raise;end if;end;
 if has_function_privilege('authenticated','public.claim_approval_notification(timestamptz)','EXECUTE') then raise exception 'public claim';end if;
end $$;
rollback;
select 'PASS: JST noon/evening zero-only, positive cancels reminder, trashed reservations excluded, unique slot, message acknowledgement replay, excluded dates, disabled, test/admin guards; all rolled back' as result;
