-- Apply after 001. A valid claim is required; replaying the same result is safe.
begin;
create or replace function public.complete_claim(p_id uuid,p_claim uuid,p_status text,p_meta_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.posts;
begin
 if p_status not in ('published','needs_review') then raise exception 'invalid status'; end if;
 if p_status='published' and (p_meta_id is null or p_meta_id !~ '^[0-9]{1,100}$') then raise exception 'invalid meta id'; end if;
 select * into p from posts where id=p_id for update;
 if not found or p.claim_id is distinct from p_claim or p_claim is null then raise exception 'invalid claim'; end if;
 if p.status=p_status and (p_status='needs_review' or p.meta_post_id=p_meta_id) then
   return jsonb_build_object('id',p.id,'status',p.status,'duplicate',true);
 end if;
 if p.status not in ('publishing','needs_review') then raise exception 'invalid transition'; end if;
 update posts set status=p_status,meta_post_id=case when p_status='published' then p_meta_id else null end,
 last_error=case when p_status='needs_review' then '公開結果が未確定です。再投稿せずMetaで照合してください。' else null end,
 version=version+1,updated_at=now() where id=p_id;
 insert into audit_log(post_id,action) values(p_id,'automation:'||p_status);
 return jsonb_build_object('id',p_id,'status',p_status,'duplicate',false);
end $$;
revoke all on function public.complete_claim(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_claim(uuid,uuid,text,text) to service_role;
commit;
