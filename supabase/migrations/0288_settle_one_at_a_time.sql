-- =====================================================================
-- Cyrix KPI  ·  0288  ·  Save policy no longer times out behind page loads
--
-- The user, 12 Nov: SW Admin -> KPI timing -> Save policy said "canceling
-- statement due to statement timeout". Saving re-settles every month
-- (settle_kpi_deadlines), which takes under a second alone; but every page
-- load settles months too, and a save started while others were settling
-- waited on their row locks past the 8-second limit. Now only one settle
-- runs at a time and the others skip it.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.settle_kpi_deadlines()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n      integer := 0;
  r      record;
  from_m date;
begin
  -- One at a time (0288): page loads all settle the months; a second one at the same moment skips instead of
  -- queueing behind the first, which once made Save policy time out (the user, 12 Nov). The next read settles anything left.
  if not pg_try_advisory_xact_lock(hashtext('settle_kpi_deadlines')) then return 0; end if;
  select (value->>'deadlines_from')::date into from_m from app_settings where key = 'tat_policy';
  perform set_config('cyrix.system_write', 'on', true);

  -- 1. Open again: the day was moved later, or the rule switched off.
  for r in
    select id, deadline_outcome, outcome_from_status
    from kpi_submissions
    where deadline_outcome is not null
      and coalesce(now() < case when deadline_outcome = 'not_scored'
            then kpi_sub_deadline(period_month, 'manager', reopen_mgr_until)
            else kpi_sub_deadline(period_month, 'tm', reopen_tm_until) end, true)
  loop
    update kpi_submissions
    set status = r.outcome_from_status, finalized_at = null,
        deadline_outcome = null, outcome_from_status = null
    where id = r.id;
    perform recompute_submission_totals(r.id);
    perform log_audit('kpi_submission', r.id, 'last_day_reopened', jsonb_build_object('was', r.deadline_outcome));
    n := n + 1;
  end loop;

  if from_m is not null then
    -- 2. A month nobody opened is still owed: open it, so it can hold its 0.
    for r in
      select a.employee_id, m::date as month
      from kpi_assignments a
      join employees e on e.id = a.employee_id and e.is_active
      join financial_years f on f.code = a.financial_year
      cross join lateral generate_series(
        greatest(date_trunc('month', f.starts_on)::date, from_m,
                 coalesce(date_trunc('month', a.starts_from)::date, from_m)),
        date_trunc('month', least(f.ends_on::date, now()::date))::date,
        interval '1 month') m
      where a.status = 'active'
        and now() >= kpi_deadline_at(m::date, 'tm')
        and not exists (select 1 from kpi_submissions s
                        where s.employee_id = a.employee_id and s.period_month = m::date)
    loop
      begin
        perform open_submission(r.employee_id, r.month);
      exception when others then
        null;  -- no KPI for that month after all; nothing is owed
      end;
    end loop;
    perform set_config('cyrix.system_write', 'on', true);

    -- 3. Not sent in by the team member's last day: 0.
    for r in
      update kpi_submissions
      set outcome_from_status = status, deadline_outcome = 'not_submitted',
          status = 'finalized', finalized_at = now()
      where status in ('draft', 'returned') and deadline_outcome is null
        and now() >= kpi_sub_deadline(period_month, 'tm', reopen_tm_until)
      returning id
    loop
      perform recompute_submission_totals(r.id);
      perform log_audit('kpi_submission', r.id, 'last_day_missed', '{"side": "tm"}'::jsonb);
      n := n + 1;
    end loop;

    -- 4. Not scored by the manager's last day: the team member's own score.
    for r in
      update kpi_submissions
      set outcome_from_status = status, deadline_outcome = 'not_scored',
          status = 'finalized', finalized_at = now()
      where status = 'submitted' and deadline_outcome is null
        and now() >= kpi_sub_deadline(period_month, 'manager', reopen_mgr_until)
      returning id
    loop
      perform recompute_submission_totals(r.id);
      perform log_audit('kpi_submission', r.id, 'last_day_missed', '{"side": "manager"}'::jsonb);
      n := n + 1;
    end loop;
  end if;

  perform set_config('cyrix.system_write', 'off', true);
  return n;
end $function$;
