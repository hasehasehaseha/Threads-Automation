begin;
do $$
declare actor uuid; j public.generation_jobs; again public.generation_jobs; n bigint; claim uuid:=gen_random_uuid();
 snapshot jsonb:='{"mode":"test","count":1,"delivery":"direct","templates":[{"name":"即時確認","category":"検証","instructions":"投稿文を一つ"}],"brief":"未保存入力"}';
begin
 select user_id into actor from members where active and role='admin' limit 1;
 select count(*) into n from posts;
 -- Isolate these fixtures from in-flight tests; all changes roll back.
 update generation_jobs set status='needs_review',created_at=created_at-interval '2 hours' where kind='test' and created_by=actor and created_at>now()-interval '1 hour';
 select * into j from begin_immediate_prompt_test(actor,snapshot,gen_random_uuid(),claim);
 if j.status<>'generating' or j.claim_id<>claim or j.target_date is not null then raise exception 'immediate claim failed'; end if;
 if exists(select 1 from claim_generation_job() where id=j.id) then raise exception 'Make stole direct test'; end if;
 select * into again from begin_immediate_prompt_test(actor,snapshot,j.id,gen_random_uuid());
 if again.claim_id<>claim then raise exception 'duplicate request re-claimed'; end if;
 begin perform complete_generation_job(j.id,claim,'[{"topic":"A","body":"A"},{"topic":"B","body":"B"},{"topic":"C","body":"C"}]');raise exception 'three outputs accepted';
 exception when raise_exception then if sqlerrm<>'wrong draft count' then raise;end if;end;
 select * into j from complete_generation_job(j.id,claim,'[{"topic":"一件","body":"即時テストの確認本文"}]');
 if j.status<>'completed' or jsonb_array_length(j.preview_posts)<>1 or j.post_ids is not null then raise exception 'preview isolation failed';end if;
 select * into again from begin_immediate_prompt_test(actor,snapshot,j.id,gen_random_uuid());
 if again.status<>'completed' or again.preview_posts<>j.preview_posts then raise exception 'cached result missing';end if;
 if (select count(*) from posts)<>n then raise exception 'test created real posts';end if;
 if has_function_privilege('authenticated','public.begin_immediate_prompt_test(uuid,jsonb,uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.begin_immediate_prompt_test(uuid,jsonb,uuid,uuid)','EXECUTE') then raise exception 'public access';end if;
end $$;
rollback;
select 'immediate single preview, replay cache, Make isolation, zero real posts and access checks passed; rolled back' as result;
