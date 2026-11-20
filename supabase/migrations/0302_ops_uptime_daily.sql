-- =====================================================================
-- Cyrix KPI  ·  0302  ·  ops_uptime_daily(): uptime over time, per day
--
-- The Ops page's Uptime panel showed one figure per app for the whole
-- period and a list of outages. Adrian asked (20 Nov 2026, after the
-- shared database ran out of connections and crash-restarted 09:40-10:06
-- IST) for a graphical view of uptime over time. This feeds it: one row
-- per IST day, with each app's checks and how many were up.
--
-- Two things the per-app figure could not show, and this does:
--
--   blind   rounds where EVERY active target failed at once. That is the
--           monitor's own database in trouble (pg_net cannot reach
--           anything), not thirteen apps failing together. They still
--           count against each app's uptime, because the apps all lean on
--           that database and were really failing, but the page draws them
--           apart so the cause is plain.
--   rounds  how many 5-minute rounds actually stored results that day. A
--           healthy day has 288. Fewer means the round itself could not
--           run (the database was down or out of connections), so that
--           day's percentages cover only part of it.
--
-- db_started is when Postgres last started. A restart nobody asked for
-- (20 Nov 04:36 UTC: "not properly shut down; automatic recovery") is the
-- clearest sign the database fell over rather than an app.
--
-- Ops admins only, like every ops_* reader. The page asks for it in the
-- slow 10-minute tier: it reads up to 90 days of checks.
-- =====================================================================

create or replace function public.ops_uptime_daily(p_days int default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 30), 1), 90);
  v_since timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' - make_interval(days => v_days - 1);
  v_n     int;
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  select count(*) into v_n from ops_target where active;

  return jsonb_build_object(
    'since', v_since,
    'db_started', pg_postmaster_start_time(),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'group', grp) order by sort_order)
      from ops_target where active), '[]'::jsonb),
    'days', coalesce((
      with c as (
        select k.target_id, k.at, k.ok, (k.at at time zone 'Asia/Kolkata')::date as day
        from ops_check k join ops_target t on t.id = k.target_id and t.active
        where k.at >= v_since
      ),
      r as (   -- one row per round
        select at, day, count(*) filter (where not ok) as bad from c group by at, day
      ),
      d as (
        select day, count(*) as rounds, count(*) filter (where bad >= v_n and v_n > 0) as blind from r group by day
      ),
      a as (
        select day, jsonb_object_agg(target_id, jsonb_build_array(n, up)) as apps
        from (select day, target_id, count(*) as n, count(*) filter (where ok) as up from c group by day, target_id) x
        group by day
      )
      select jsonb_agg(jsonb_build_object('day', d.day, 'rounds', d.rounds, 'blind', d.blind, 'apps', a.apps) order by d.day)
      from d join a using (day)), '[]'::jsonb)
  );
end $$;

revoke all on function public.ops_uptime_daily(int) from public, anon;
grant execute on function public.ops_uptime_daily(int) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ops_uptime_daily(int)', 'execute') then
    raise exception '0302: anon can call ops_uptime_daily';
  end if;
end $$;
