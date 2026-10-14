-- Who has the device check off, as one array (the user, 15 Oct: E1971 showed ticked though off).
-- device_check_off_list returns a row per person, and PostgREST stops at 1,000 rows; with
-- everyone off (0195) that is 1,327, so the rest showed as checked.
create or replace function public.device_check_off_ids()
returns uuid[] language sql stable security definer set search_path to 'public' as $f$
  select coalesce(array_agg(employee_id), '{}') from device_check_off where is_sw_admin()
$f$;
revoke all on function public.device_check_off_ids() from public, anon;
grant execute on function public.device_check_off_ids() to authenticated;
