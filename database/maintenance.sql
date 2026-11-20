-- Schedule daily with the same restricted Xyvora database role. These queries
-- only affect expired platform data. Run 001_platform.sql first.
begin;
delete from xyvora_sessions where expires_ms <= extract(epoch from now()) * 1000;
delete from xyvora_auth_attempts where expires_ms <= extract(epoch from now()) * 1000;
delete from xyvora_jobs where created_ms < extract(epoch from now() - interval '30 days') * 1000;
delete from xyvora_browser_days where utc_day < floor(extract(epoch from now()) / 86400) - 89;
delete from xyvora_browsers where last_ms < extract(epoch from now() - interval '90 days') * 1000
  or (revoked and last_ms < extract(epoch from now() - interval '1 day') * 1000);
commit;
