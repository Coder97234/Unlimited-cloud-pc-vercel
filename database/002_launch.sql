-- Upgrade after 001_platform.sql. Run both as the schema owner, then grant the
-- runtime and worker roles only the table privileges described in the runbook.
begin;

alter table xyvora_accounts add column if not exists credential_version integer not null default 0;
alter table xyvora_sessions add column if not exists credential_version integer not null default 0;
create index if not exists xyvora_sessions_account on xyvora_sessions(account_id);

create table if not exists xyvora_email_links (
  digest text primary key,
  purpose text not null check (purpose in ('signup', 'reset')),
  email text not null,
  expires_ms bigint not null,
  unique (purpose, email)
);
create index if not exists xyvora_email_links_expiry on xyvora_email_links(expires_ms);
create table if not exists xyvora_auth_limits (
  digest text primary key,
  count integer not null,
  expires_ms bigint not null
);
create index if not exists xyvora_auth_limits_expiry on xyvora_auth_limits(expires_ms);

create table if not exists xyvora_cloud_history (
  account_id uuid primary key references xyvora_accounts(id) on delete cascade,
  revision uuid not null,
  chats jsonb not null check (jsonb_typeof(chats) = 'array' and jsonb_array_length(chats) <= 24)
);
create table if not exists xyvora_preferences (
  account_id uuid primary key references xyvora_accounts(id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 512)
);
alter table xyvora_memory drop constraint if exists xyvora_memory_profile_check;
alter table xyvora_memory add constraint xyvora_memory_profile_check check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 65536);

alter table xyvora_jobs add column if not exists attempts integer not null default 0;
alter table xyvora_jobs add column if not exists lease uuid;
alter table xyvora_jobs add column if not exists lease_until_ms bigint not null default 0;
alter table xyvora_jobs add column if not exists runnable_ms bigint not null default 0;
alter table xyvora_jobs drop constraint if exists xyvora_jobs_state_check;
alter table xyvora_jobs add constraint xyvora_jobs_state_check check (state in ('queued', 'running', 'finished', 'error', 'cancelled'));
drop index if exists xyvora_jobs_one_running;
create unique index if not exists xyvora_jobs_one_active on xyvora_jobs(account_id) where state in ('queued', 'running');
create index if not exists xyvora_jobs_runnable on xyvora_jobs(runnable_ms, created_ms) where state in ('queued', 'running');
create table if not exists xyvora_worker_health (
  id text primary key,
  last_ms bigint not null
);
commit;
