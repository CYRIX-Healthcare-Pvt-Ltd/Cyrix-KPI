-- =====================================================================
-- Cyrix KPI  ·  0305  ·  Maintenance mode for every app, and for the Ops admins
--
-- Adrian, 20 Nov: extend Kevin's maintenance mode (0303_platform_maintenance,
-- 0304) to cover what it left out:
--
--   1. More apps. 0303 knew portal, kpi, travel, bemmp, revive, tasks and cyra.
--      Workplace, Projects and Pulse now draw the same screen, so the switch
--      has to accept them.
--   2. The Ops admins (SW_ADMIN, Adrian, Kevin: is_ops_admin()) get through the
--      screen and may set the switch. 0303 let only the SW_ADMIN account in, so
--      the two people most likely to be doing the backend work were locked out
--      of the apps they were checking.
--   3. platform_maintenance_status(): what Cyra needs. Cyra signs in against its
--      own Supabase project, so it has no session here and cannot call
--      platform_maintenance(). The portal's /api/maintenance calls this with the
--      anon key and caches the answer at Vercel's edge for 30 seconds, so Cyra's
--      users never reach this database at all. It returns only the schedule:
--      on, from, to, apps, notice_min and the server clock. Not who set it.
--
-- Also records 0303_platform_maintenance and 0304 in _migrations: both were
-- applied by hand on 20 Nov without their ledger rows.
-- =====================================================================

create or replace function public.platform_maintenance()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = 'maintenance'), '{"on": false}'::jsonb)
         || jsonb_build_object('now', now(), 'admin', is_sw_admin() or is_ops_admin())
$$;
revoke all on function public.platform_maintenance() from public, anon;
grant execute on function public.platform_maintenance() to authenticated;

create or replace function public.platform_set_maintenance(p_on boolean, p_from timestamptz, p_to timestamptz, p_apps text[], p_notice_min integer default 15)
returns void language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not (is_sw_admin() or is_ops_admin()) then
    raise exception 'Only the software administrator or an Ops admin can change this';
  end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'To must be after From'; end if;
  if p_apps is not null and exists (select 1 from unnest(p_apps) a where a not in
       ('portal', 'kpi', 'travel', 'bemmp', 'revive', 'tasks', 'cyra', 'workplace', 'projects', 'pulse')) then
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

-- The schedule only, for apps with no session in this project (Cyra). Anon on purpose: see 3. above.
create or replace function public.platform_maintenance_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on', coalesce((v->>'on')::boolean, false),
    'from', v->'from', 'to', v->'to', 'apps', coalesce(v->'apps', '[]'::jsonb),
    'notice_min', coalesce((v->>'notice_min')::int, 15), 'now', now())
  from (select coalesce((select value from app_settings where key = 'maintenance'), '{"on": false}'::jsonb) as v) s
$$;
revoke all on function public.platform_maintenance_status() from public;
grant execute on function public.platform_maintenance_status() to anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.platform_set_maintenance(boolean, timestamptz, timestamptz, text[], integer)', 'execute')
     or has_function_privilege('anon', 'public.platform_maintenance()', 'execute') then
    raise exception '0305: maintenance functions are too widely granted';
  end if;
  if (select platform_maintenance_status() ? 'by') then
    raise exception '0305: the public status must not say who set it';
  end if;
end $$;

insert into _migrations (filename, checksum) values
  ('0303_platform_maintenance.sql', 'c958c80b0041bf00'),
  ('0304_maintenance_notice_before.sql', 'f4a490cb0de3ff7d')
on conflict do nothing;
