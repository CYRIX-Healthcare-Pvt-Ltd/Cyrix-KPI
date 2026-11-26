-- =====================================================================
-- Cyrix KPI  ·  0312  ·  SW Admin → Module summary
--
-- The user, 26 Nov: "each module assigned to, live user, used, used %
-- (and custom date filter for used, so from this date i can check how
-- many used)" — like the My Task question ("how many use it now").
-- Cyra Assist and Pulse left out (the user: "dont need cyra", "pulse
-- dont need"): their use is recorded outside this database.
--
-- Assigned = active employees holding the module (employee_modules).
-- Live     = of those, signed in at least once.
-- Used     = of those, did something in the module from p_from (IST):
--   KPI        sent in their KPI, or scored someone
--   BEMMP      worked a Quotation tracker request or a Medtronic ticket
--   Revive Lab raised or moved a ticket
--   Travel     started a day, took a visit photo, or made a claim
--   My Task    created a task or acted on one
--   Workplace  raised a ticket or logged time
--   Projects   raised a ticket
-- Test accounts (E6666/E7777/E8888/E9999, "- Test" names) are never counted.
-- SW Admin only.
-- =====================================================================
create or replace function public.sw_module_usage(p_from date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare f timestamptz := (coalesce(p_from, date '2000-01-01')::timestamp at time zone 'Asia/Kolkata');
begin
  if not coalesce(is_sw_admin(), false) then
    raise exception 'Only the SW Admin can see the module summary.';
  end if;
  return (
    with real as (
      select e.id from employees e
      where e.is_active and e.ecode not in ('E6666', 'E7777', 'E8888', 'E9999') and e.full_name !~* '-\s*test'
    ),
    used(m, id) as (
      select 'kpi', employee_id from kpi_submissions where self_submitted_at >= f
      union select 'kpi', manager_id from kpi_submissions where manager_scored_at >= f
      union select 'bemmp', by from qt_events where at >= f
      union select 'bemmp', by from mt_events where at >= f
      union select 'revive', actor_id from revive_ticket_events where at >= f
      union select 'revive', raised_by from revive_tickets where created_at >= f
      union select 'travel', employee_id from te_day_starts where at >= f
      union select 'travel', employee_id from te_visit_photos where shot_at >= f
      union select 'travel', employee_id from te_claims where created_at >= f
      union select 'tasks', created_by from task_items where created_at >= f
      union select 'tasks', by_id from task_events where at >= f
      union select 'workplace', raised_by from wp_tickets where created_at >= f
      union select 'workplace', employee_id from wp_time_entries where created_at >= f
      union select 'projects', raised_by from prj_tickets where created_at >= f
    ),
    rows as (
      select a.code, a.name, a.sort_order,
        count(distinct m.employee_id) as assigned,
        count(distinct m.employee_id) filter (where u.last_sign_in_at is not null) as live,
        count(distinct x.id) as used
      from app_modules a
      left join (employee_modules m join real r on r.id = m.employee_id) on m.module_code = a.code
      left join auth.users u on u.id = (select e.auth_user_id from employees e where e.id = m.employee_id)
      left join used x on x.m = a.code and x.id = m.employee_id
      where a.is_active and a.code not in ('cyra', 'pulse')
      group by a.code, a.name, a.sort_order
    )
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'assigned', assigned, 'live', live, 'used', used)
      order by sort_order), '[]'::jsonb) from rows
  );
end $$;

revoke all on function public.sw_module_usage(date) from public, anon;
grant execute on function public.sw_module_usage(date) to authenticated;
