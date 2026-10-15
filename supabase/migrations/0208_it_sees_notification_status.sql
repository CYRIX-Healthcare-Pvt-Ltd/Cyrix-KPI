-- IT Admin sees who has notifications on too (the user, 15 Oct: their Logins tab read 0).
create or replace function public.app_status_ids()
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select case when is_sw_admin() or is_hr_admin() or is_it_admin() then jsonb_build_object(
    'push', (select coalesce(jsonb_agg(distinct employee_id), '[]') from push_subscriptions where coalesce(failures, 0) < 3))
  end
$f$;
