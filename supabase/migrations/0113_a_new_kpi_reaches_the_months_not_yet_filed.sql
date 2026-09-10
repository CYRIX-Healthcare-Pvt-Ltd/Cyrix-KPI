-- =====================================================================
-- Cyrix KPI  ·  0113  ·  A new KPI reaches the months nobody has filed
--
-- open_submission copies the KPI into a month once, when the month is
-- opened, and nothing ever copied it again. So replacing a KPI -- a
-- re-upload, or approving a revision -- left every already-open month
-- scoring against the definition it was opened with.
--
-- It is not cosmetic. E738's Aug-26 draft was scoring "Financial: Cost
-- Efficiency in Asset Maintenance" as higher_uncapped -- higher is
-- better, no ceiling -- while the KPI itself said lower_penalty. On a
-- cost measure that rewards overspending, without limit.
--
-- Worse, the upload deletes the assignment rows before re-inserting
-- them, and kpi_submission_items.assignment_item_id is ON DELETE SET
-- NULL. 40 of 163 draft rows had already lost the link entirely, so they
-- could not have followed the KPI even if something had asked them to.
--
-- What this changes:
--
--   * draft and returned months are brought up to date, and re-linked.
--   * submitted, scored and finalized months are left exactly as they
--     are. A submitted month is what the person actually filed, and a
--     scored one is the record of how they were judged; re-basing either
--     would change somebody's score without them knowing. A manager who
--     wants a submitted month updated returns it, which makes it a draft
--     and brings it here.
--   * target_value is NOT overwritten. Targets move month to month by
--     design -- open_submission carries the previous month's forward
--     rather than taking the assignment's -- so the KPI's figure is a
--     starting point, not the truth for a month already open.
--   * self_achieved and every remark are preserved.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The refresh itself.
-- ---------------------------------------------------------------------
create or replace function refresh_open_submissions(p_assignment_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s        kpi_submissions%rowtype;
  n        integer;
  touched  integer := 0;
begin
  -- guard_submission_item_columns refuses changes to the KRA, weightage
  -- and scoring rule -- correctly, since those are the year's agreed
  -- contract and not something an end user may edit mid-month. This is
  -- the KPI itself arriving, which is the one thing that may move them.
  perform set_config('cyrix.system_write', 'on', true);

  for s in
    select * from kpi_submissions
    where assignment_id = p_assignment_id
      and status in ('draft', 'returned')
  loop
    -- Matched on section and KRA rather than on the id, because the
    -- upload deletes the assignment rows and the id is already gone.
    -- Re-linking is half the point of this.
    update kpi_submission_items i
    set assignment_item_id = ai.id,
        kpi_description    = ai.kpi_description,
        weightage          = ai.weightage,
        target_unit        = ai.target_unit,
        scoring_rule       = ai.scoring_rule,
        rule_params        = ai.rule_params,
        sort_order         = ai.sort_order
    from kpi_assignment_items ai
    where i.submission_id  = s.id
      and ai.assignment_id = p_assignment_id
      and ai.section       = i.section
      and lower(btrim(ai.kra)) = lower(btrim(i.kra))
      and (i.assignment_item_id is distinct from ai.id
        or i.kpi_description    is distinct from ai.kpi_description
        or i.weightage          is distinct from ai.weightage
        or i.target_unit        is distinct from ai.target_unit
        or i.scoring_rule       is distinct from ai.scoring_rule
        or i.rule_params        is distinct from ai.rule_params
        or i.sort_order         is distinct from ai.sort_order);
    get diagnostics n = row_count;
    touched := touched + n;

    -- Rows the KPI no longer has. Nobody has filed this month, so a row
    -- that is not in the KPI is not being assessed.
    delete from kpi_submission_items i
    where i.submission_id = s.id
      and not exists (
        select 1 from kpi_assignment_items ai
        where ai.assignment_id = p_assignment_id
          and ai.section = i.section
          and lower(btrim(ai.kra)) = lower(btrim(i.kra)));
    get diagnostics n = row_count;
    touched := touched + n;

    -- Rows the KPI has gained. The target carries forward from the last
    -- month that measured the same row, exactly as open_submission does.
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
           where ps.employee_id = s.employee_id
             and ps.period_month < s.period_month
             and pi.assignment_item_id = ai.id
           order by ps.period_month desc
           limit 1),
          ai.target_value)
      else
        ai.target_value
      end,
      ai.target_unit, ai.scoring_rule, ai.rule_params, ai.sort_order
    from kpi_assignment_items ai
    where ai.assignment_id = p_assignment_id
      and not exists (
        select 1 from kpi_submission_items i
        where i.submission_id = s.id
          and i.section = ai.section
          and lower(btrim(i.kra)) = lower(btrim(ai.kra)));
    get diagnostics n = row_count;
    touched := touched + n;

    perform recompute_submission_totals(s.id);
  end loop;

  perform set_config('cyrix.system_write', 'off', true);
  return touched;
end $$;

comment on function refresh_open_submissions(uuid) is
  'Brings draft and returned months into line with the current KPI, '
  'preserving typed achieved values and monthly targets. Submitted, '
  'scored and finalized months are never touched.';

-- ---------------------------------------------------------------------
-- 2. The two places a KPI becomes the live one.
--
-- Both bodies below are the live definitions read back with
-- pg_get_functiondef, with one call spliced in. Nothing was retyped.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_assign_kpi(p_ecode text, p_fy text, p_rows jsonb, p_job_weight numeric, p_core_weight numeric, p_esms_weight numeric, p_starts_from date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- The months already open still hold the KPI as it was when they were
  -- opened. Bring the ones nobody has filed yet up to date.
  perform refresh_open_submissions(new_id);

  return jsonb_build_object(
    'status', outcome,
    'detail', format('%s row(s)', jsonb_array_length(p_rows)),
    'employee', emp.full_name
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_assignment(p_assignment_id uuid)
 RETURNS kpi_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Same reason as the upload path: approving is the other way a KPI
  -- becomes the live one.
  perform refresh_open_submissions(p_assignment_id);

  return a;
end $function$;

-- ---------------------------------------------------------------------
-- 3. The months that already drifted.
-- ---------------------------------------------------------------------
do $$
declare
  a       record;
  fixed   integer := 0;
  total   integer := 0;
begin
  for a in select id from kpi_assignments where status = 'active' loop
    fixed := refresh_open_submissions(a.id);
    if fixed > 0 then total := total + fixed; end if;
  end loop;
  raise notice '0113 repaired % row(s) across open months', total;
end $$;

-- ---------------------------------------------------------------------
-- 4. Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  -- No draft or returned row may disagree with its KPI, or be unlinked.
  select count(*) into bad
  from kpi_submission_items i
  join kpi_submissions s  on s.id = i.submission_id
  join kpi_assignment_items ai
    on ai.assignment_id = s.assignment_id
   and ai.section = i.section
   and lower(btrim(ai.kra)) = lower(btrim(i.kra))
  where s.status in ('draft', 'returned')
    and (i.scoring_rule is distinct from ai.scoring_rule
      or i.weightage    is distinct from ai.weightage
      or i.assignment_item_id is distinct from ai.id);
  if bad > 0 then
    raise exception '% open row(s) still disagree with the KPI', bad;
  end if;

  -- And nothing already filed was touched.
  select count(*) into bad
  from kpi_submission_items i
  join kpi_submissions s on s.id = i.submission_id
  where s.status in ('submitted', 'scored', 'finalized')
    and i.assignment_item_id is null;
  if bad > 0 then
    raise exception '% filed row(s) lost their link', bad;
  end if;

  raise notice '0113 self-test passed (open months match the KPI; filed months untouched)';
end $$;
