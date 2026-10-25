begin;
create function public.claim_history_generation_job() returns setof public.generation_jobs
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext('history-generation-claim'));
 update generation_jobs set status='needs_review',test_error='生成の応答を確認できませんでした。自動再実行はしません。'
 where kind='production' and status='generating' and claimed_at<now()-interval '15 minutes';
 update generation_jobs j set status='needs_review',test_error='投稿予定時刻を過ぎたため確認待ちにしました。'
 where status='queued' and kind='production' and (target_date<(now() at time zone 'Asia/Tokyo')::date or exists(
 select 1 from jsonb_array_elements_text(coalesce(j.prompt_snapshot->'times','["08:00","12:00","20:00"]'::jsonb)) t where (j.target_date+t::time) at time zone 'Asia/Tokyo'<=now()));
 -- Only one production batch may run at a time, so a later date sees the previous batch's drafts.
 if exists(select 1 from generation_jobs where kind='production' and status='generating') then return;end if;
 return query update generation_jobs set status='generating',claim_id=gen_random_uuid(),claimed_at=now()
 where id=(select j.id from generation_jobs j join members m on m.user_id=j.created_by and m.active
 where j.kind='production' and j.status='queued' order by j.created_at for update of j skip locked limit 1) returning *;
end $$;
revoke all on function public.claim_history_generation_job() from public,anon,authenticated;
grant execute on function public.claim_history_generation_job() to service_role;
commit;
