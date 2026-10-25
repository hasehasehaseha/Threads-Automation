begin;
do $$
declare actor uuid; settings bigint; j uuid:=gen_random_uuid(); tj uuid:=gen_random_uuid(); call_id uuid:=gen_random_uuid(); n bigint; marker text:='history-fixture-'||gen_random_uuid(); history jsonb; used numeric;
begin
 select user_id into actor from members where active and role='admin' limit 1;
 select id into settings from editorial_settings order by id desc limit 1;
 select count(*) into n from posts;
 insert into generation_jobs(id,created_by,settings_id,settings_snapshot,target_date,status,kind)
 values(j,actor,settings,'{}','2049-01-01','generating','production'),(tj,actor,settings,'{}',null,'generating','test');
 if not reserve_ai_call(call_id,j,'gpt-6.1-sol','generate',.1) then raise exception 'first reservation refused';end if;
 if reserve_ai_call(call_id,j,'gpt-6.1-sol','generate',.1) then raise exception 'replay allowed';end if;
 update generation_jobs set claimed_at=now() where id=j;
 if exists(select 1 from claim_history_generation_job()) then raise exception 'parallel production claimed';end if;
 select (ai_month_usage()->>'productionUsd')::numeric into used;
 if used<20 then insert into ai_usage(id,job_id,kind,model,purpose,reserved_usd) values(gen_random_uuid(),j,'production','gpt-6.1-sol','fixture',20-used);end if;
 begin perform reserve_ai_call(gen_random_uuid(),j,'gpt-6.1-sol','retry',.1);raise exception 'over budget accepted';
 exception when raise_exception then if sqlerrm<>'monthly production budget reached' then raise;end if;end;
 if not reserve_ai_call(gen_random_uuid(),tj,'gpt-6.1-sol','generate',.1) then raise exception 'test restricted by production budget';end if;
 insert into posts(created_by,body,topic,scheduled_at) values
 (actor,'参照する履歴',marker||'-include','2048-12-20 08:00+09'),
 (actor,'対象外の古い履歴',marker||'-old','2048-10-01 08:00+09'),
 (actor,'対象外の先の履歴',marker||'-future','2049-02-01 08:00+09');
 history:=history_for_generation('2049-01-01');
 if not exists(select 1 from jsonb_array_elements(history) p where p->>'topic'=marker||'-include') then raise exception 'recent missing';end if;
 if exists(select 1 from jsonb_array_elements(history) p where p->>'topic' in(marker||'-old',marker||'-future')) then raise exception 'date window broken';end if;
 if (select count(*) from posts)<>n+3 then raise exception 'unexpected posts created';end if;
 begin perform save_ai_config(gen_random_uuid(),1,'gpt-6-luna');raise exception 'unauthorized model change';
 exception when raise_exception then if sqlerrm<>'admin required' then raise;end if;end;
 if has_function_privilege('anon','public.reserve_ai_call(uuid,uuid,text,text,numeric)','EXECUTE')
 or has_function_privilege('authenticated','public.history_for_generation(date)','EXECUTE')
 or has_table_privilege('authenticated','public.post_memory','SELECT')
 or has_table_privilege('anon','public.ai_usage','SELECT') then raise exception 'browser access';end if;
end $$;
rollback;
select 'PASS: reservation replay, monthly cap, separate test budget, history dates, admin-only settings, service-only access; fixtures rolled back' as result;
