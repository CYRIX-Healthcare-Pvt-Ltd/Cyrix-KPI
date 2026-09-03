-- =====================================================================
-- Cyrix KPI  ·  0085  ·  A bulk-assigned KPI is a whole KPI
--
-- bulk_assign_kpi inserts exactly the rows it is handed, and the caller
-- hands it Job Role rows only. So every person assigned through the bulk
-- screen got an assignment saying core_values_weight = 20 with nothing
-- in that band to score -- eighty points of KPI and twenty points of
-- nothing. Their total could never pass 80, and the monthly assessment
-- had no core-values row to rate them on.
--
-- It was masked while the template carried core values, because the
-- sheet looked complete even though the rows were filtered out on the
-- way in. Removing them from the template made it visible rather than
-- causing it.
--
-- The fix is not to put them back in the sheet. Core values are the same
-- five for the whole company -- that is what "universal" means -- and a
-- row every uploader has to retype identically is a row every uploader
-- can get wrong. apply_standard_core_values() already exists and already
-- reads the company row from app_settings; the bulk path simply never
-- called it.
--
-- ESMS has the same hole and gets the same treatment. It cannot go
-- through set_esms(): that one refuses anything not in draft, and these
-- arrive active by design.
-- =====================================================================
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
  esms_cfg jsonb;
  next_ord int;
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

  -- ESMS before core values, so the sort order reads the way the screens
  -- do: job role, ESMS, then core values last.
  if coalesce(p_esms_weight, 0) > 0 then
    select value into esms_cfg from app_settings where key = 'esms_row';
    if esms_cfg is null then
      raise exception 'No esms_row configured in app_settings';
    end if;
    select coalesce(max(sort_order), 0) + 1 into next_ord
    from kpi_assignment_items where assignment_id = new_id;

    insert into kpi_assignment_items (
      assignment_id, section, kra, kpi_description,
      weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
    values (
      new_id, 'esms',
      esms_cfg->>'kra', esms_cfg->>'kpi_description',
      p_esms_weight, (esms_cfg->>'target_value')::numeric, 'score',
      esms_cfg->>'scoring_rule', '{}'::jsonb, next_ord);
  end if;

  -- The company's five, at whatever the remainder came to. Reads the
  -- weight off the assignment, which is why it runs after the update
  -- above rather than before it.
  perform apply_standard_core_values(new_id);

  return jsonb_build_object(
    'status', outcome,
    'detail', format('%s row(s)', jsonb_array_length(p_rows)),
    'employee', emp.full_name
  );
end;
$function$;

revoke all on function public.bulk_assign_kpi(text, text, jsonb, numeric, numeric, numeric, date)
  from public, anon;
grant execute on function public.bulk_assign_kpi(text, text, jsonb, numeric, numeric, numeric, date)
  to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Runs as the software admin, because that is the only role the function
-- answers to. Rolled back at the end -- the probe employee and every row
-- hung off it go with it.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id  uuid;
  admin_e uuid;
  admin_u uuid;
  res     jsonb;
  bands   text;
  total   numeric;
  a_id    uuid;
begin
  -- Somebody to be, and somebody to be it as.
  select e.id, e.auth_user_id into admin_e, admin_u
  from employees e join user_roles ur on ur.employee_id = e.id
  where ur.role = 'sw_admin' and e.auth_user_id is not null and e.is_active
  limit 1;
  if admin_e is null then
    raise notice '0085 self-test skipped (no sw_admin with a login to run as)';
    return;
  end if;

  insert into employees (ecode, full_name, is_active)
  values ('ZZ-0085-PROBE', 'Probe', true) returning id into emp_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);

  -- No ESMS: core values must take the whole 20.
  res := bulk_assign_kpi(
    'ZZ-0085-PROBE', '2026-27',
    jsonb_build_array(jsonb_build_object(
      'section', 'job_role', 'kra', 'Probe row', 'weightage', 80,
      'target_value', 100, 'scoring_rule', 'higher_capped', 'sort_order', 1)),
    80, 20, 0, null);

  if res->>'status' <> 'created' then
    raise exception 'Expected created, got %', res->>'status';
  end if;

  select a.id into a_id from kpi_assignments a
  where a.employee_id = emp_id and a.financial_year = '2026-27';

  select string_agg(distinct section, ',' order by section), sum(weightage)
  into bands, total
  from kpi_assignment_items where assignment_id = a_id;

  if bands <> 'core_values,job_role' then
    raise exception 'Expected core_values and job_role, got %', bands;
  end if;
  if total <> 100 then
    raise exception 'The bands total %, not 100', total;
  end if;

  -- With ESMS the remainder splits, and all three bands must be present.
  res := bulk_assign_kpi(
    'ZZ-0085-PROBE', '2026-27',
    jsonb_build_array(jsonb_build_object(
      'section', 'job_role', 'kra', 'Probe row', 'weightage', 80,
      'target_value', 100, 'scoring_rule', 'higher_capped', 'sort_order', 1)),
    80, 15, 5, date '2026-09-01');

  if res->>'status' <> 'replaced' then
    raise exception 'Expected replaced, got %', res->>'status';
  end if;

  select string_agg(distinct section, ',' order by section), sum(weightage)
  into bands, total
  from kpi_assignment_items where assignment_id = a_id;

  if bands <> 'core_values,esms,job_role' then
    raise exception 'Expected all three bands, got %', bands;
  end if;
  if total <> 100 then
    raise exception 'With ESMS the bands total %, not 100', total;
  end if;
  if (select count(*) from kpi_assignment_items
      where assignment_id = a_id and section = 'core_values') <> 1 then
    raise exception 'Replacing left more than one core values row';
  end if;
  if (select starts_from from kpi_assignments where id = a_id) <> date '2026-09-01' then
    raise exception 'The start month from the sheet was not stored';
  end if;

  raise notice '0085 self-test passed (bulk uploads now produce a KPI totalling 100)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
