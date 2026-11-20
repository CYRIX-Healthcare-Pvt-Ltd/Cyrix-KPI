-- =====================================================================
-- Cyrix KPI  ·  0303  ·  "Cyra is under maintenance"
--
-- The user, 20 Nov (after the 09:41 memory outage and before the Micro →
-- Small restart): an under-maintenance screen like the splash, shown when an
-- app breaks, and switched on by hand from SW Admin → Platform. From – To
-- with dates; a notice bar 15 minutes before From; the To time only shows
-- "Back by"; it stays on until SW Admin turns it off; SW Admin still gets in.
-- Apps: all, or chosen ones (portal, kpi, travel, bemmp, revive, tasks, cyra).
-- Every app's src/lib/maintenance.ts reads platform_maintenance() each minute.
-- =====================================================================

insert into app_settings (key, value) values ('maintenance', '{"on": false}'::jsonb)
on conflict (key) do nothing;

-- What every app asks: the switch, its From – To, which apps, the server's
-- clock (a phone's may be wrong) and whether the person is SW Admin.
create or replace function public.platform_maintenance()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = 'maintenance'), '{"on": false}'::jsonb)
         || jsonb_build_object('now', now(), 'admin', is_sw_admin())
$$;
revoke all on function public.platform_maintenance() from public, anon;
grant execute on function public.platform_maintenance() to authenticated;

-- SW Admin only. p_apps empty or null = every app.
create or replace function public.platform_set_maintenance(p_on boolean, p_from timestamptz, p_to timestamptz, p_apps text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change this'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'To must be after From'; end if;
  if p_apps is not null and exists (select 1 from unnest(p_apps) a where a not in ('portal', 'kpi', 'travel', 'bemmp', 'revive', 'tasks', 'cyra')) then
    raise exception 'Unknown app';
  end if;
  select e.full_name || ' (' || e.ecode || ')' into v_who from employees e where e.id = current_employee_id();
  insert into app_settings (key, value) values ('maintenance', jsonb_build_object(
      'on', coalesce(p_on, false), 'from', p_from, 'to', p_to,
      'apps', to_jsonb(coalesce(p_apps, '{}'::text[])), 'by', v_who, 'at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function public.platform_set_maintenance(boolean, timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.platform_set_maintenance(boolean, timestamptz, timestamptz, text[]) to authenticated;
