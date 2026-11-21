-- Apply after 001_platform.sql and 002_launch.sql as the schema owner with
-- CREATEROLE. Safe to rerun. Supabase can grant its Data API roles access to
-- public tables by default; the Xyvora tables are for the server only.
begin;

do $xyvora$
declare
  relation text;
  api_role text;
begin
  if not exists (select 1 from pg_roles where rolname = 'xyvora_app') then
    create role xyvora_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'xyvora_worker') then
    create role xyvora_worker nologin;
  end if;
  grant usage on schema public to xyvora_app, xyvora_worker;
  foreach relation in array array[
    'xyvora_accounts', 'xyvora_sessions', 'xyvora_auth_attempts', 'xyvora_memory',
    'xyvora_browsers', 'xyvora_browser_days', 'xyvora_jobs', 'xyvora_email_links',
    'xyvora_auth_limits', 'xyvora_cloud_history', 'xyvora_preferences', 'xyvora_worker_health'
  ] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, xyvora_app, xyvora_worker', relation);
    foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all on public.%I from %I', relation, api_role);
      end if;
    end loop;
    execute format('drop policy if exists xyvora_app_access on public.%I', relation);
    if relation = 'xyvora_worker_health' then
      execute format('grant select on public.%I to xyvora_app', relation);
      execute format('create policy xyvora_app_access on public.%I for select to xyvora_app using (true)', relation);
    else
      execute format('grant select, insert, update, delete on public.%I to xyvora_app', relation);
      execute format('create policy xyvora_app_access on public.%I to xyvora_app using (true) with check (true)', relation);
    end if;
  end loop;
end $xyvora$;

grant select, update on public.xyvora_jobs to xyvora_worker;
grant select, insert, update on public.xyvora_worker_health to xyvora_worker;
drop policy if exists xyvora_worker_access on public.xyvora_jobs;
create policy xyvora_worker_access on public.xyvora_jobs to xyvora_worker using (true) with check (true);
drop policy if exists xyvora_worker_access on public.xyvora_worker_health;
create policy xyvora_worker_access on public.xyvora_worker_health to xyvora_worker using (true) with check (true);

-- Poolers need not accept statement_timeout as a startup packet parameter.
alter role xyvora_app set statement_timeout to '5s';
alter role xyvora_worker set statement_timeout to '5s';
commit;
