-- Apply after 003 as the schema owner. Project files contain extracted text,
-- never original uploads. API roles do not get direct access.
begin;
create table if not exists public.xyvora_projects (
  account_id uuid not null references public.xyvora_accounts(id) on delete cascade,
  id uuid not null,
  name text not null check (char_length(name) between 1 and 72),
  description text not null default '' check (char_length(description) <= 320),
  instructions text not null default '' check (char_length(instructions) <= 1200),
  color text not null check (color in ('violet','blue','teal','amber')),
  icon text not null check (icon in ('folder','book','code','spark')),
  updated_ms bigint not null,
  primary key (account_id, id)
);
create index if not exists xyvora_projects_updated on public.xyvora_projects(account_id, updated_ms desc, id);
create table if not exists public.xyvora_project_files (
  account_id uuid not null, project_id uuid not null, id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  body text not null check (char_length(body) between 1 and 8000 and octet_length(body) <= 32000),
  truncated boolean not null default false,
  updated_ms bigint not null,
  keywords tsvector generated always as (to_tsvector('simple', name || ' ' || body)) stored,
  primary key (account_id, project_id, id),
  foreign key (account_id, project_id) references public.xyvora_projects(account_id, id) on delete cascade
);
create index if not exists xyvora_project_files_search on public.xyvora_project_files using gin (keywords);

do $projects$
declare relation text; api_role text;
begin
  foreach relation in array array['xyvora_projects', 'xyvora_project_files'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('alter table public.%I force row level security', relation);
    execute format('revoke all on public.%I from public, xyvora_worker, xyvora_app', relation);
    foreach api_role in array array['anon','authenticated','service_role'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all on public.%I from %I', relation, api_role);
      end if;
    end loop;
    execute format('grant select, insert, update, delete on public.%I to xyvora_app', relation);
    execute format('drop policy if exists xyvora_project_owner on public.%I', relation);
    execute format('create policy xyvora_project_owner on public.%I to xyvora_app using (account_id = nullif(current_setting(''xyvora.account_id'',true),'''')::uuid) with check (account_id = nullif(current_setting(''xyvora.account_id'',true),'''')::uuid)', relation);
  end loop;
end $projects$;
commit;
