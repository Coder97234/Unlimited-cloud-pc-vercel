-- Public identifiers are separate from the secret session digests.
-- Apply before enabling XYVORA_ENABLE_SESSIONS. Existing cookies keep working.
begin;
alter table public.xyvora_sessions add column if not exists session_id uuid not null default gen_random_uuid();
alter table public.xyvora_sessions add column if not exists created_ms bigint;
alter table public.xyvora_sessions alter column created_ms set default ((extract(epoch from now()) * 1000)::bigint);
create unique index if not exists xyvora_sessions_public_id on public.xyvora_sessions(account_id,session_id);
commit;
