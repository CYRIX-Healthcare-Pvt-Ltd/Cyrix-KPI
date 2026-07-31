-- =====================================================================
-- Cyrix KPI  ·  0005  ·  Identity helpers, workflow RPCs, reporting views
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity helpers. security definer so they can read `employees`
-- before RLS is satisfied -- RLS policies themselves depend on these.
-- ---------------------------------------------------------------------
create or replace function current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from employees where auth_user_id = auth.uid() and is_active
$$;

create or replace function is_hr_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    join employees e on e.id = ur.employee_id
    where e.auth_user_id = auth.uid()
      and ur.role in ('hr_admin','super_admin')
  )
$$;

-- Direct line manager only (not skip-level). Change to a recursive CTE
-- here if Cyrix ever wants managers to see their whole sub-tree.
create or replace function manages_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees tm
    join employees mgr on mgr.id = tm.reporting_manager_id
    where tm.id = p_employee_id
      and mgr.auth_user_id = auth.uid()
  )
$$;

create or replace function log_audit(
  p_entity_type text, p_entity_id uuid, p_action text, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (current_employee_id(), p_entity_type, p_entity_id, p_action, p_details);
$$;


-- =====================================================================
-- Assignment validation -- weightages must add up before anything can
-- go live, otherwise a TM could quietly ship a 60% KPI sheet.
-- =====================================================================
create or replace function validate_assignment(p_assignment_id uuid)
returns table (ok boolean, message text)
language plpgsql stable as $$
declare
  a           kpi_assignments%rowtype;
  job_sum     numeric;
  core_sum    numeric;
  item_count  int;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then
    return query select false, 'Assignment not found'; return;
  end if;

  select
    coalesce(sum(weightage) filter (where section = 'job_role'), 0),
    coalesce(sum(weightage) filter (where section = 'core_values'), 0),
    count(*)
  into job_sum, core_sum, item_count
  from kpi_assignment_items where assignment_id = p_assignment_id;

  if item_count = 0 then
    return query select false, 'No KPI rows have been added'; return;
  end if;
  if job_sum <> a.job_role_weight then
    return query select false, format(
      'Job Role weightages total %s%%, they must total %s%%', job_sum, a.job_role_weight);
    return;
  end if;
  if core_sum <> a.core_values_weight then
    return query select false, format(
      'Core Values weightages total %s%%, they must total %s%%', core_sum, a.core_values_weight);
    return;
  end if;

  return query select true, 'Valid';
end $$;


-- =====================================================================
-- Assignment lifecycle: draft -> pending_approval -> active | rejected
-- =====================================================================
create or replace function submit_assignment_for_approval(p_assignment_id uuid)
returns kpi_assignments
language plpgsql security definer set search_path = public as $$
declare
  a   kpi_assignments%rowtype;
  v   record;
  me  uuid := current_employee_id();
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.employee_id <> me and not is_hr_admin() then
    raise exception 'You can only submit your own KPI for approval';
  end if;
  if a.status not in ('draft','rejected') then
    raise exception 'Only a draft or rejected KPI can be submitted (current: %)', a.status;
  end if;

  select * into v from validate_assignment(p_assignment_id);
  if not v.ok then raise exception '%', v.message; end if;

  update kpi_assignments
  set status = 'pending_approval', submitted_at = now(), submitted_by = me,
      rejection_reason = null
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'submitted_for_approval', '{}'::jsonb);
  return a;
end $$;


create or replace function approve_assignment(p_assignment_id uuid)
returns kpi_assignments
language plpgsql security definer set search_path = public as $$
declare
  a  kpi_assignments%rowtype;
  v  record;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if not (manages_employee(a.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can approve this KPI';
  end if;
  if a.status <> 'pending_approval' then
    raise exception 'Only a KPI awaiting approval can be approved (current: %)', a.status;
  end if;

  select * into v from validate_assignment(p_assignment_id);
  if not v.ok then raise exception '%', v.message; end if;

  update kpi_assignments
  set status = 'active', approved_at = now(), approved_by = current_employee_id()
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'approved', '{}'::jsonb);
  return a;
end $$;


create or replace function reject_assignment(p_assignment_id uuid, p_reason text)
returns kpi_assignments
language plpgsql security definer set search_path = public as $$
declare a kpi_assignments%rowtype;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if not (manages_employee(a.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can reject this KPI';
  end if;
  if a.status <> 'pending_approval' then
    raise exception 'Only a KPI awaiting approval can be rejected (current: %)', a.status;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when rejecting a KPI';
  end if;

  update kpi_assignments
  set status = 'rejected', rejection_reason = p_reason
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'rejected',
                    jsonb_build_object('reason', p_reason));
  return a;
end $$;


-- =====================================================================
-- Monthly submission lifecycle
-- =====================================================================

-- Materialise a month from the employee's ACTIVE assignment. Idempotent:
-- calling it twice returns the existing submission rather than duplicating.
create or replace function open_submission(p_employee_id uuid, p_period_month date)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare
  s      kpi_submissions%rowtype;
  a      kpi_assignments%rowtype;
  fy     text;
  month1 date := date_trunc('month', p_period_month)::date;
begin
  select * into s from kpi_submissions
  where employee_id = p_employee_id and period_month = month1;
  if found then return s; end if;

  select code into fy from financial_years
  where month1 between starts_on and ends_on;
  if fy is null then
    raise exception 'No financial year covers %', month1;
  end if;

  select * into a from kpi_assignments
  where employee_id = p_employee_id and financial_year = fy and status = 'active';
  if not found then
    raise exception 'No approved KPI is in place for this employee for FY %', fy;
  end if;

  insert into kpi_submissions (assignment_id, employee_id, manager_id,
                               financial_year, period_month, status)
  select a.id, p_employee_id, e.reporting_manager_id, fy, month1, 'draft'
  from employees e where e.id = p_employee_id
  returning * into s;

  -- freeze the KPI definition into the month
  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  select s.id, ai.id, ai.section, ai.kra, ai.kpi_description,
         ai.weightage, ai.target_value, ai.target_unit,
         ai.scoring_rule, ai.rule_params, ai.sort_order
  from kpi_assignment_items ai
  where ai.assignment_id = a.id;

  -- one blank rating row per active core value
  insert into core_value_ratings (submission_id, core_value_id)
  select s.id, cv.id from core_value_definitions cv where cv.is_active;

  perform log_audit('kpi_submission', s.id, 'opened',
                    jsonb_build_object('period', month1));
  return s;
end $$;


create or replace function submit_self_assessment(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare
  s       kpi_submissions%rowtype;
  missing int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if s.employee_id <> current_employee_id() then
    raise exception 'You can only submit your own assessment';
  end if;
  if s.status not in ('draft','returned') then
    raise exception 'This month has already been submitted (current: %)', s.status;
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section = 'job_role'
    and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  select count(*) into missing
  from core_value_ratings
  where submission_id = p_submission_id and self_rating is null;
  if missing > 0 then
    raise exception '% core value(s) have not been rated', missing;
  end if;

  update kpi_submissions
  set status = 'submitted', self_submitted_at = now(), return_reason = null
  where id = p_submission_id returning * into s;

  perform log_audit('kpi_submission', p_submission_id, 'self_submitted', '{}'::jsonb);
  return s;
end $$;


create or replace function return_submission(p_submission_id uuid, p_reason text)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can return this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'Only a submitted month can be returned (current: %)', s.status;
  end if;

  update kpi_submissions
  set status = 'returned', returned_at = now(), return_reason = p_reason
  where id = p_submission_id returning * into s;

  perform log_audit('kpi_submission', p_submission_id, 'returned',
                    jsonb_build_object('reason', p_reason));
  return s;
end $$;


create or replace function submit_manager_scores(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare
  s       kpi_submissions%rowtype;
  missing int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can score this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'This month is not ready for scoring (current: %)', s.status;
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section = 'job_role'
    and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  update kpi_submissions
  set status = 'scored', manager_scored_at = now()
  where id = p_submission_id returning * into s;

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored',
                    jsonb_build_object('total', s.final_total_score));
  return s;
end $$;


-- Locks the month. This is the number appraisal and PIP read.
create or replace function finalize_submission(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can finalise this';
  end if;
  if s.status <> 'scored' then
    raise exception 'Only a scored month can be finalised (current: %)', s.status;
  end if;

  update kpi_submissions
  set status = 'finalized', finalized_at = now()
  where id = p_submission_id returning * into s;

  perform log_audit('kpi_submission', p_submission_id, 'finalized',
                    jsonb_build_object('total', s.final_total_score));
  return s;
end $$;


-- HR-only escape hatch for a genuine mistake after locking.
create or replace function reopen_submission(p_submission_id uuid, p_reason text)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  if not is_hr_admin() then
    raise exception 'Only HR can reopen a finalised month';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reopen a finalised month';
  end if;

  update kpi_submissions
  set status = 'scored', finalized_at = null
  where id = p_submission_id and status = 'finalized'
  returning * into s;
  if not found then raise exception 'Submission is not finalised'; end if;

  perform log_audit('kpi_submission', p_submission_id, 'reopened',
                    jsonb_build_object('reason', p_reason));
  return s;
end $$;


-- =====================================================================
-- Reporting views
-- =====================================================================

-- Per-KRA monthly grid + annual average: the "Annual Performance" sheet,
-- with its three broken subtotal formulas fixed.
create or replace view v_annual_kra_scores as
select
  s.employee_id,
  s.financial_year,
  i.section,
  i.kra,
  min(i.sort_order)                                      as sort_order,
  extract(month from s.period_month)::int                as month_no,
  to_char(s.period_month, 'Mon-YY')                      as month_label,
  s.period_month,
  sum(coalesce(i.final_score, i.self_score))             as month_score
from kpi_submissions s
join kpi_submission_items i on i.submission_id = s.id
where s.status in ('scored','finalized')
group by s.employee_id, s.financial_year, i.section, i.kra, s.period_month;


create or replace view v_annual_summary as
select
  s.employee_id,
  e.ecode,
  e.full_name,
  e.reporting_manager_id,
  s.financial_year,
  count(*) filter (where s.status = 'finalized')          as months_finalized,
  count(*)                                                as months_scored,
  round(avg(s.final_job_role_score), 2)                   as avg_job_role_score,
  round(avg(s.final_core_score), 2)                       as avg_core_values_score,
  round(avg(s.final_total_score), 2)                      as avg_total_score,
  min(s.final_total_score)                                as lowest_month,
  max(s.final_total_score)                                as highest_month
from kpi_submissions s
join employees e on e.id = s.employee_id
where s.status in ('scored','finalized')
group by s.employee_id, e.ecode, e.full_name, e.reporting_manager_id, s.financial_year;


-- What a manager sees on their team dashboard.
create or replace view v_team_status as
select
  e.id                       as employee_id,
  e.ecode,
  e.full_name,
  e.designation,
  e.reporting_manager_id,
  jr.name                    as job_role,
  a.id                       as assignment_id,
  a.status                   as kpi_status,
  a.financial_year,
  s.id                       as submission_id,
  s.period_month,
  s.status                   as submission_status,
  s.self_total_score,
  s.mgr_total_score,
  s.final_total_score
from employees e
left join job_roles jr        on jr.id = e.job_role_id
left join kpi_assignments a   on a.employee_id = e.id
                             and a.status in ('draft','pending_approval','active')
left join kpi_submissions s   on s.employee_id = e.id
                             and s.period_month = date_trunc('month', current_date - interval '1 month')::date
where e.is_active;
