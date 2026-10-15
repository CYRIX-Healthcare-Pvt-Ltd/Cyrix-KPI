-- The last-day rules switched on or off from KPI timing (the user, 15 Oct). Off empties
-- deadlines_from, which kpi_deadline_at and every screen read as "no last days"; the month they
-- applied from is kept in deadlines_from_saved and restored when they are switched on again.
create or replace function public.set_kpi_last_days(p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare prev jsonb; v jsonb;
begin
  if not (is_sw_admin() or is_hr_admin()) then raise exception 'Only SW Admin can change the KPI timing'; end if;
  select value into prev from app_settings where key = 'tat_policy';
  prev := coalesce(prev, '{}'::jsonb);
  if p_on then
    v := prev || jsonb_build_object('deadlines_from',
      coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved', prev->>'starts_from', '2026-09-01'));
  else
    v := prev || jsonb_build_object('deadlines_from', null,
      'deadlines_from_saved', coalesce(prev->>'deadlines_from', prev->>'deadlines_from_saved'));
  end if;
  update app_settings set value = v, updated_at = now() where key = 'tat_policy';
  perform log_audit('setting', null, case when p_on then 'kpi_last_days_on' else 'kpi_last_days_off' end, '{}'::jsonb);
  perform settle_kpi_deadlines();
  return v;
end $f$;
revoke all on function public.set_kpi_last_days(boolean) from public, anon;
grant execute on function public.set_kpi_last_days(boolean) to authenticated;
