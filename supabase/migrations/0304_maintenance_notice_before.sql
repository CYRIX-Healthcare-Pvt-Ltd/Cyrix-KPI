-- =====================================================================
-- Cyrix KPI  ·  0304  ·  Maintenance: how long before From the bar shows
--
-- The user, 20 Nov: "need show banner before hr also field". SW Admin picks
-- how long before From the notice bar appears (15 minutes to a day; 0303 had
-- a fixed 15 minutes). Kept as notice_min with the rest of the setting.
-- =====================================================================

drop function if exists public.platform_set_maintenance(boolean, timestamptz, timestamptz, text[]);
create or replace function public.platform_set_maintenance(p_on boolean, p_from timestamptz, p_to timestamptz, p_apps text[], p_notice_min integer default 15)
returns void language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change this'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'To must be after From'; end if;
  if p_apps is not null and exists (select 1 from unnest(p_apps) a where a not in ('portal', 'kpi', 'travel', 'bemmp', 'revive', 'tasks', 'cyra')) then
    raise exception 'Unknown app';
  end if;
  if coalesce(p_notice_min, 15) not between 0 and 1440 then raise exception 'Notice must be at most a day'; end if;
  select e.full_name || ' (' || e.ecode || ')' into v_who from employees e where e.id = current_employee_id();
  insert into app_settings (key, value) values ('maintenance', jsonb_build_object(
      'on', coalesce(p_on, false), 'from', p_from, 'to', p_to,
      'apps', to_jsonb(coalesce(p_apps, '{}'::text[])), 'notice_min', coalesce(p_notice_min, 15),
      'by', v_who, 'at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function public.platform_set_maintenance(boolean, timestamptz, timestamptz, text[], integer) from public, anon;
grant execute on function public.platform_set_maintenance(boolean, timestamptz, timestamptz, text[], integer) to authenticated;
