-- Install as the owner of a dedicated Xyvora database. Use a separate app role
-- with data access to these tables, not an administrator connection, at runtime.
create table if not exists xyvora_accounts (
  id uuid primary key,
  provider text not null,
  subject text not null,
  name text not null,
  email text not null default '',
  password_hash text,
  created_ms bigint not null,
  unique (provider, subject)
);
create table if not exists xyvora_sessions (
  digest text primary key,
  account_id uuid not null references xyvora_accounts(id) on delete cascade,
  expires_ms bigint not null
);
create index if not exists xyvora_sessions_expiry on xyvora_sessions(expires_ms);
create table if not exists xyvora_auth_attempts (
  digest text primary key,
  provider text not null,
  verifier text not null,
  expires_ms bigint not null
);
create table if not exists xyvora_memory (
  account_id uuid primary key references xyvora_accounts(id) on delete cascade,
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 8192)
);

-- Independent, optional browser measurement; no account ID, URL, IP, or prompt.
create table if not exists xyvora_browsers (
  digest text primary key,
  last_ms bigint not null,
  revoked boolean not null default false
);
create index if not exists xyvora_browsers_last on xyvora_browsers(last_ms);
create table if not exists xyvora_browser_days (
  digest text not null references xyvora_browsers(digest) on delete cascade,
  utc_day integer not null,
  primary key (digest, utc_day)
);
create index if not exists xyvora_browser_days_recent on xyvora_browser_days(utc_day);

create table if not exists xyvora_jobs (
  id uuid primary key,
  account_id uuid not null references xyvora_accounts(id) on delete cascade,
  prompt text not null,
  state text not null check (state in ('running', 'finished', 'error', 'cancelled')),
  result text not null default '',
  created_ms bigint not null,
  updated_ms bigint not null
);
create unique index if not exists xyvora_jobs_one_running on xyvora_jobs(account_id) where state = 'running';
create index if not exists xyvora_jobs_account_created on xyvora_jobs(account_id, created_ms desc);
create index if not exists xyvora_jobs_expiry on xyvora_jobs(created_ms);
