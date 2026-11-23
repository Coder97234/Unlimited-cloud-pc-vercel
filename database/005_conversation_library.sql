-- Additive schema. Each account is cut over only on its first library request.
-- Clear legacy JSON in the SAME transaction as the copy, so deleting a new
-- conversation does not keep an accessible duplicate in legacy history.
begin;
alter table public.xyvora_cloud_history add column if not exists migrated boolean not null default false;

create or replace function public.xyvora_freeze_legacy_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.migrated then
    raise exception using errcode='55000', message='This account uses the Xyvora conversation library';
  end if;
  return new;
end;
$$;
revoke all on function public.xyvora_freeze_legacy_history() from public;
drop trigger if exists xyvora_freeze_legacy_history on public.xyvora_cloud_history;
create trigger xyvora_freeze_legacy_history before update on public.xyvora_cloud_history
for each row execute function public.xyvora_freeze_legacy_history();

create table if not exists public.xyvora_library (
  account_id uuid primary key references public.xyvora_accounts(id) on delete cascade,
  revision uuid not null
);
create table if not exists public.xyvora_chats (
  account_id uuid not null references public.xyvora_library(account_id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  project_id uuid,
  revision uuid not null,
  title text not null check (char_length(title) <= 100),
  mode text not null check (mode in ('chat','compare')),
  pinned boolean not null default false,
  favorite boolean not null default false,
  archived boolean not null default false,
  updated_ms bigint not null,
  turns jsonb not null check (jsonb_typeof(turns) = 'array' and jsonb_array_length(turns) between 1 and 120 and octet_length(turns::text) <= 2000000),
  bytes integer generated always as (octet_length(turns::text)) stored,
  keywords tsvector generated always as (to_tsvector('simple', title) || jsonb_to_tsvector('simple', turns, '["string"]'::jsonb)) stored,
  primary key (account_id, id),
  foreign key (account_id, project_id) references public.xyvora_projects(account_id, id) on delete set null (project_id)
);
create index if not exists xyvora_chats_recent on public.xyvora_chats(account_id, pinned desc, updated_ms desc, id desc) where not archived;
create index if not exists xyvora_chats_project_recent on public.xyvora_chats(account_id, project_id, pinned desc, updated_ms desc, id desc);
create index if not exists xyvora_chats_keywords on public.xyvora_chats using gin (keywords);

do $library$
declare relation text; api_role text;
begin
  foreach relation in array array['xyvora_library', 'xyvora_chats'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('alter table public.%I force row level security', relation);
    execute format('revoke all on public.%I from public, xyvora_worker, xyvora_app', relation);
    foreach api_role in array array['anon','authenticated','service_role'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all on public.%I from %I', relation, api_role);
      end if;
    end loop;
    execute format('grant select, insert, update, delete on public.%I to xyvora_app', relation);
    execute format('drop policy if exists xyvora_chat_owner on public.%I', relation);
    execute format('create policy xyvora_chat_owner on public.%I to xyvora_app using (account_id = nullif(current_setting(''xyvora.account_id'',true),'''')::uuid) with check (account_id = nullif(current_setting(''xyvora.account_id'',true),'''')::uuid)', relation);
  end loop;
end $library$;
commit;
