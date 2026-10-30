/*
  0228 — Ops counts days in India time (the user, 30 Oct: the Ops page read "31 Oct: 0" sign-ins at 00:15 IST).

  0227 bucketed sign-ins and activity by UTC day, so from midnight to 05:30 IST every morning the newest bar was a
  UTC day that had not started yet, and every bar was split across two Indian days. Only ops_overview() changes:
  the window now starts at an India midnight and every per-day bucket is an India date. Nothing else is touched.

  Undo: re-run the ops_overview() definition from 0227.
*/

create or replace function ops_overview(p_days int default 30)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare
  since timestamptz;
  out   jsonb;
begin
  if not is_ops_admin() then
    raise exception 'Ops admins only.' using errcode = '42501';
  end if;
  since := (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)) - 1);

  with activity as (
    select 'kpi'::text as module, created_at as at, actor_id as who, action from audit_log where created_at >= since
    union all select 'spare', performed_at, performed_by, action from equipment_history where performed_at >= since
    union all select 'bemmp', changed_at, changed_by, 'note: ' || column_name from meeting_note_history where changed_at >= since
    union all select 'revive', at, actor_id, coalesce(action, kind, status) from revive_ticket_events where at >= since
    union all select 'revive', at, actor_id, 'component: ' || action from revive_component_log where at >= since
    union all select 'travel', at, actor_id, action from te_events where at >= since
    union all select 'tasks', at, by_id, kind from task_events where at >= since
  )
  select jsonb_build_object(
    'since', since,
    'accounts', (
      select jsonb_build_object(
        'total',      count(*),
        'signed_in_1d',  count(*) filter (where last_sign_in_at > now() - interval '1 day'),
        'signed_in_7d',  count(*) filter (where last_sign_in_at > now() - interval '7 days'),
        'signed_in_30d', count(*) filter (where last_sign_in_at > now() - interval '30 days'),
        'never',      count(*) filter (where last_sign_in_at is null))
      from auth.users),
    -- One row per person per day they verified a sign-in on a device (0149).
    'signins_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'users', n) order by d)
      from (select (verified_at at time zone 'Asia/Kolkata')::date d, count(distinct user_id) n
            from device_sessions where verified_at >= since group by 1) s), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'active', a.is_active, 'users', (
               select count(*) from employee_modules m where m.module_code = a.code)) order by a.sort_order)
      from app_modules a), '[]'::jsonb),
    'activity_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'module', module, 'events', n) order by d, module)
      from (select (at at time zone 'Asia/Kolkata')::date d, module, count(*) n from activity group by 1, 2) s), '[]'::jsonb),
    'active_by_module', coalesce((
      select jsonb_agg(jsonb_build_object('module', module, 'users', u, 'events', n) order by n desc)
      from (select module, count(distinct who) u, count(*) n from activity group by 1) s), '[]'::jsonb),
    'top_actions', coalesce((
      select jsonb_agg(jsonb_build_object('module', module, 'action', action, 'events', n) order by n desc)
      from (select module, action, count(*) n from activity
            where at >= now() - interval '7 days' and action is not null
            group by 1, 2 order by 3 desc limit 20) s), '[]'::jsonb)
  ) into out
  from (select 1) one;

  return out;
end $$;

do $$
begin
  -- No signed-in caller here: it must still refuse.
  begin
    perform ops_overview(7);
    raise exception '0228: ops_overview() answered a caller who is not an Ops admin';
  exception when insufficient_privilege then null;
  end;
  raise notice '0228: ops_overview() now counts India days';
end $$;
