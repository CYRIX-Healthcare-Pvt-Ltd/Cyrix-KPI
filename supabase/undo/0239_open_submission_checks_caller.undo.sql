-- Undo 0239: open_submission without the caller check (the pre-0239 body).
CREATE OR REPLACE FUNCTION public.open_submission(p_employee_id uuid, p_period_month date)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if a.starts_from is not null and month1 < a.starts_from then
    raise exception
      'This KPI starts from %, so % is not assessed.',
      to_char(a.starts_from, 'Mon-YY'), to_char(month1, 'Mon-YY');
  end if;

  insert into kpi_submissions (assignment_id, employee_id, manager_id,
                               financial_year, period_month, status)
  select a.id, p_employee_id, e.reporting_manager_id, fy, month1, 'draft'
  from employees e where e.id = p_employee_id
  returning * into s;

  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  select
    s.id, ai.id, ai.section, ai.kra, ai.kpi_description,
    ai.weightage,
    case when ai.section = 'job_role' then
      coalesce(
        (select pi.target_value
         from kpi_submission_items pi
         join kpi_submissions ps on ps.id = pi.submission_id
         where ps.employee_id = p_employee_id
           and ps.period_month < month1
           and pi.assignment_item_id = ai.id
         order by ps.period_month desc
         limit 1),
        ai.target_value)
    else
      ai.target_value
    end,
    ai.target_unit, ai.scoring_rule, ai.rule_params, ai.sort_order
  from kpi_assignment_items ai
  where ai.assignment_id = a.id;

  insert into core_value_ratings (submission_id, core_value_id)
  select s.id, cv.id from core_value_definitions cv where cv.is_active;
  perform ensure_core_parts(s.id);

  perform log_audit('kpi_submission', s.id, 'opened',
                    jsonb_build_object('period', month1));
  return s;
end $function$;
delete from _migrations where filename = '0239_open_submission_checks_caller.sql';
