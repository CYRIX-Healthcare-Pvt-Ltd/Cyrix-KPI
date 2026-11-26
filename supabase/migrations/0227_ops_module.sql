/*
  0227 — Ops: one page for the people who run the apps (the user, 30 Oct: "a high level overview dashboard access
  for selective users (SW_admin, Kevin, Adrian) where we can monitor the overall performance, usage, statistics of
  all apps we deploy").

  The page lives in the portal (cyrix-platform, /ops). This file gives it three things:

  1. A tile. `ops` in app_modules, granted to SW_ADMIN, Kevin Raju (E1427) and Adrian (E1791), and to nobody else.
  2. A lock on that grant. employee_modules is writable by HR admin as well as SW admin, which is right for every
     other tile and wrong for this one: the Ops page reads every app's activity, and the HR login is the account the
     9 Oct audit found still on its default password. So only SW admin (or the service role / SQL editor, where
     there is no signed-in caller) may add, move or remove an `ops` row. HR keeps everything else it had.
  3. is_ops_admin() and ops_overview(). The page and the portal's /api/ops function both ask is_ops_admin() with
     the caller's own token, so the database decides who is an Ops admin, not the page. ops_overview() returns
     counts only — accounts, sign-ins per day, grants per tile, and activity per module from each app's own trail.
     No names, no ticket contents, no scores leave it.

  Activity is read from the trails the apps already keep: KPI audit_log, Spare equipment_history, BEMMP
  meeting_note_history, Revive revive_ticket_events + revive_component_log, Travel te_events, My Task task_events.
  Pulse and CYRA are on other databases and are read by /api/ops instead.

  Undo: supabase/undo/0227_ops_module.undo.sql.
*/

insert into app_modules (code, name, description, path, icon, sort_order)
values ('ops', 'Ops', 'Health, errors, usage, changes and AI cost across every Cyrix app.', '/ops', 'Gauge', 90)
on conflict (code) do nothing;

/* ---- 2. only SW admin may hand out Ops --------------------------------------------------------------------- */

create or replace function guard_ops_grant()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (tg_op <> 'INSERT' and old.module_code = 'ops') or (tg_op <> 'DELETE' and new.module_code = 'ops') then
    -- No signed-in caller: a migration, the SQL editor or the service role. Otherwise SW admin only.
    if auth.uid() is not null and not is_sw_admin() then
      raise exception 'Only the SW admin can grant or remove the Ops module.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

revoke all on function guard_ops_grant() from public, anon;

drop trigger if exists employee_modules_ops_guard on employee_modules;
create trigger employee_modules_ops_guard
  before insert or update or delete on employee_modules
  for each row execute function guard_ops_grant();

insert into employee_modules (employee_id, module_code)
select id, 'ops' from employees where ecode in ('SW_ADMIN', 'E1427', 'E1791')
on conflict do nothing;

/* ---- 3. who is an Ops admin, and what they see -------------------------------------------------------------- */

create or replace function is_ops_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from employee_modules m
    join app_modules a on a.code = m.module_code and a.is_active
    where m.module_code = 'ops' and m.employee_id = current_employee_id()
  )
$$;

revoke all on function is_ops_admin() from public, anon;
grant execute on function is_ops_admin() to authenticated, service_role;

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
  since := date_trunc('day', now()) - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)) - 1);

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
      from (select date_trunc('day', verified_at)::date d, count(distinct user_id) n
            from device_sessions where verified_at >= since group by 1) s), '[]'::jsonb),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'active', a.is_active, 'users', (
               select count(*) from employee_modules m where m.module_code = a.code)) order by a.sort_order)
      from app_modules a), '[]'::jsonb),
    'activity_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'module', module, 'events', n) order by d, module)
      from (select date_trunc('day', at)::date d, module, count(*) n from activity group by 1, 2) s), '[]'::jsonb),
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

revoke all on function ops_overview(int) from public, anon;
grant execute on function ops_overview(int) to authenticated, service_role;

/* ---- self-test ---------------------------------------------------------------------------------------------- */

do $$
declare n int;
begin
  select count(*) into n from employee_modules where module_code = 'ops';
  if n = 0 then raise exception '0227: nobody holds the ops module'; end if;
  -- No signed-in caller here, so neither function may say yes.
  if is_ops_admin() then raise exception '0227: is_ops_admin() said yes to nobody'; end if;
  begin
    perform ops_overview(7);
    raise exception '0227: ops_overview() answered a caller who is not an Ops admin';
  exception when insufficient_privilege then null;
  end;
  raise notice '0227: ops granted to % account(s); is_ops_admin() and ops_overview() refuse a stranger', n;
end $$;
