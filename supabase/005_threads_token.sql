-- Encrypted credential storage. Only the existing server service role can access it.
begin;
create table public.threads_credentials (
 id text primary key check(id='neis_hiroshima'),
 encrypted_token text not null,
 expires_at timestamptz,
 refreshed_at timestamptz,
 next_attempt_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','healthy','error','reconnect')),
 last_error text,
 last_attempt_at timestamptz,
 claim_id uuid,
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.threads_credentials enable row level security;
revoke all on public.threads_credentials from anon,authenticated;
grant all on public.threads_credentials to service_role;

create function public.claim_threads_refresh() returns setof public.threads_credentials
language plpgsql security definer set search_path=public as $$
begin
 return query update threads_credentials set claim_id=gen_random_uuid(),claimed_at=now(),last_attempt_at=now()
 where id='neis_hiroshima' and next_attempt_at<=now() and status<>'reconnect'
 and (claimed_at is null or claimed_at<now()-interval '15 minutes')
 returning *;
end $$;

create function public.complete_threads_refresh(p_claim uuid,p_encrypted text default null,p_expires timestamptz default null,p_error text default null,p_reconnect boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_error is null and (p_encrypted is null or p_expires<=now() or p_expires is null) then raise exception 'invalid refreshed credential'; end if;
 update threads_credentials set
 encrypted_token=case when p_error is null then p_encrypted else encrypted_token end,
 expires_at=case when p_error is null then p_expires else expires_at end,
 refreshed_at=case when p_error is null then now() else refreshed_at end,
 next_attempt_at=now()+case when p_error is null then interval '7 days' else interval '25 hours' end,
 status=case when p_error is null then 'healthy' when p_reconnect then 'reconnect' else 'error' end,
 last_error=left(p_error,200),claimed_at=null,claim_id=null,updated_at=now()
 where id='neis_hiroshima' and claim_id=p_claim and p_claim is not null;
 return found;
end $$;
revoke all on function public.claim_threads_refresh() from public,anon,authenticated;
revoke all on function public.complete_threads_refresh(uuid,text,timestamptz,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_threads_refresh() to service_role;
grant execute on function public.complete_threads_refresh(uuid,text,timestamptz,text,boolean) to service_role;
commit;
