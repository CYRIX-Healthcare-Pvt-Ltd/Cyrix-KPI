-- Install tracking dropped (the user, 15 Oct): installs before 0197 could not be known, so the
-- count would mislead. Notifications stay.
create or replace function public.app_status_ids()
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select case when is_sw_admin() or is_hr_admin() then jsonb_build_object(
    'push', (select coalesce(jsonb_agg(distinct employee_id), '[]') from push_subscriptions where coalesce(failures, 0) < 3))
  end
$f$;
drop function if exists public.note_installed(text);
drop table if exists public.app_installs;
