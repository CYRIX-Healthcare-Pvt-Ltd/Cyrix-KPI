-- Assign one KRA set to many people at once.
--
-- A divisional manager has two hundred reports on the same job, and the
-- same eight rows had to be typed by each of them and approved by him
-- two hundred times. Nobody was going to do that, so the KPIs did not
-- get set up, and the year started with people uncovered.
--
-- Uploaded by the software admin, so it arrives approved. There is no
-- manager to ask: the manager is who this is being done on behalf of,
-- and a queue of two hundred approvals for rows he supplied is the same
-- work wearing a different hat.
--
-- One employee per call. Two hundred separate transactions rather than
-- one, deliberately -- a single bad row in a file of two hundred should
-- cost that row, not the other hundred and ninety-nine, and the caller
-- reports on each one individually.
create or replace function public.bulk_assign_kpi(
  p_ecode text,
  p_fy text,
  p_rows jsonb,
  p_job_weight numeric,
  p_core_weight numeric,
  p_esms_weight numeric,
  p_starts_from date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  emp employees;
  existing kpi_assignments;
  scored_months int;
  -- The caller as an employee row. submitted_by and approved_by are
  -- foreign keys into employees, not auth users, so auth.uid() went in
  -- and bounced off the constraint.
  actor uuid;
  new_id uuid;
  outcome text;
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can bulk assign KPIs';
  end if;

  select id into actor from employees where auth_user_id = auth.uid();

  select * into emp from employees where upper(btrim(ecode)) = upper(btrim(p_ecode));
  if emp is null then
    return jsonb_build_object('status', 'skipped', 'detail', 'No employee with that code');
  end if;
  if not emp.is_active then
    return jsonb_build_object('status', 'skipped', 'detail', 'That employee is not active');
  end if;

  select * into existing
  from kpi_assignments
  where employee_id = emp.id and financial_year = p_fy;

  -- A month that has been scored is a record of what somebody was judged
  -- against, and rewriting the rows underneath it would change the
  -- meaning of a score already given without changing the score. The
  -- whole person is skipped rather than half-replaced.
  if existing.id is not null then
    select count(*) into scored_months
    from kpi_submissions
    where employee_id = emp.id
      and financial_year = p_fy
      and status in ('scored', 'finalized');

    if scored_months > 0 then
      return jsonb_build_object(
        'status', 'skipped',
        'detail', format('Already scored for %s month(s) this year', scored_months)
      );
    end if;
  end if;

  if existing.id is not null then
    -- Replaced in place: the id is what submissions and history point at,
    -- so a delete and re-insert would orphan a draft somebody had started.
    delete from kpi_assignment_items where assignment_id = existing.id;
    update kpi_assignments set
      status = 'active',
      job_role_weight = p_job_weight,
      core_values_weight = p_core_weight,
      esms_weight = p_esms_weight,
      starts_from = coalesce(p_starts_from, starts_from),
      submitted_at = now(),
      submitted_by = actor,
      approved_at = now(),
      approved_by = actor,
      rejection_reason = null,
      updated_at = now()
    where id = existing.id;
    new_id := existing.id;
    outcome := 'replaced';
  else
    insert into kpi_assignments (
      employee_id, financial_year, status,
      job_role_weight, core_values_weight, esms_weight, starts_from,
      submitted_at, submitted_by, approved_at, approved_by
    ) values (
      emp.id, p_fy, 'active',
      p_job_weight, p_core_weight, p_esms_weight, p_starts_from,
      now(), actor, now(), actor
    )
    returning id into new_id;
    outcome := 'created';
  end if;

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, sort_order, alternates
  )
  select
    new_id,
    r->>'section',
    r->>'kra',
    nullif(r->>'kpi_description', ''),
    (r->>'weightage')::numeric,
    nullif(r->>'target_value', '')::numeric,
    nullif(r->>'target_unit', ''),
    r->>'scoring_rule',
    coalesce(r->'rule_params', '{}'::jsonb),
    coalesce((r->>'sort_order')::int, 0),
    '[]'::jsonb
  from jsonb_array_elements(p_rows) r;

  return jsonb_build_object(
    'status', outcome,
    'detail', format('%s row(s)', jsonb_array_length(p_rows)),
    'employee', emp.full_name
  );
end;
$function$;

revoke all on function public.bulk_assign_kpi(text, text, jsonb, numeric, numeric, numeric, date) from public, anon;
grant execute on function public.bulk_assign_kpi(text, text, jsonb, numeric, numeric, numeric, date) to authenticated;

notify pgrst, 'reload schema';
