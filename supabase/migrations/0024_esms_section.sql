-- =====================================================================
-- Cyrix KPI  ·  0024  ·  ESMS, a third weighted section
--
-- Some roles carry an ESMS obligation — incident reporting within TAT,
-- report submission, quality management and training. On the sheet it is
-- its own band between Job Role and Core Values:
--
--            without ESMS          with ESMS
--   Job Role       80%                  80%
--   ESMS            —                    5%
--   Core Values    20%                   15%
--                 ----                 ----
--                 100%                 100%
--
-- The 5% comes OUT OF core values, not out of the job role. A person's
-- own KRAs are worth the same either way; what changes is how the
-- remaining fifth is split.
--
-- Like core values, the row itself is standard — one definition in
-- app_settings, stamped on rather than typed in, so ESMS means the same
-- thing for everyone who carries it. Unlike core values, it is scored
-- from a number entered each month rather than from the five ratings,
-- because the sheet gives it a target of 100 the way every measurable
-- row has one.
--
-- The section roll-up now reads "everything that is not the job role"
-- instead of naming core values, so the reported split stays 80 / 20 and
-- every view, export and chart downstream keeps working untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Let the three item tables hold the new section.
--
-- The checks were written inline in 0002 and 0003, so they carry
-- generated names. Found rather than guessed.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  c text;
begin
  foreach t in array array[
    'kpi_template_items', 'kpi_assignment_items', 'kpi_submission_items'
  ] loop
    for c in
      select con.conname
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      where cl.relname = t
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%section%'
    loop
      execute format('alter table %I drop constraint %I', t, c);
    end loop;

    execute format(
      'alter table %I add constraint %I '
      'check (section in (''job_role'', ''core_values'', ''esms''))',
      t, t || '_section_check');
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2. The weight, per person.
--
-- Zero for everybody until their KPI says otherwise, so nothing that
-- already exists changes shape.
-- ---------------------------------------------------------------------
alter table kpi_assignments
  add column if not exists esms_weight numeric(6,3) not null default 0;

comment on column kpi_assignments.esms_weight is
  'ESMS share of the 100%, taken from core_values_weight. 0 or 5.';


-- ---------------------------------------------------------------------
-- 3. The standard row, as data.
--
-- Same bargain as core_values_row: HR can reword it, move its target or
-- change how it is scored without a migration, and everyone who carries
-- ESMS carries the same one.
-- ---------------------------------------------------------------------
insert into app_settings (key, value, description) values
  ('esms_row',
   jsonb_build_object(
     'kra', 'ESMS Monitoring and reporting',
     'kpi_description',
       'Incident reporting within TAT and report submission, '
       'Quality management and training',
     'weightage', 5,
     'target_value', 100,
     'scoring_rule', 'higher_capped'),
   'The single ESMS KPI row, applied to the people who carry an ESMS '
   'obligation. Its 5% is taken out of the core values block, so the '
   'job role stays at 80%.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 4. Stamping the standard rows.
--
-- apply_standard_core_values used to take its weightage from the setting,
-- which was fine while 20 was the only answer. It now takes it from the
-- assignment, because that is where the 20-or-15 decision lives.
-- ---------------------------------------------------------------------
create or replace function apply_standard_core_values(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cfg      jsonb;
  wt       numeric;
  next_ord int;
begin
  select value into cfg from app_settings where key = 'core_values_row';
  if cfg is null then
    raise exception 'No core_values_row configured in app_settings';
  end if;

  select core_values_weight into wt
  from kpi_assignments where id = p_assignment_id;
  if wt is null then
    raise exception 'Assignment not found';
  end if;

  delete from kpi_assignment_items
  where assignment_id = p_assignment_id and section = 'core_values';

  select coalesce(max(sort_order), 0) + 1 into next_ord
  from kpi_assignment_items where assignment_id = p_assignment_id;

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  values (
    p_assignment_id, 'core_values',
    cfg->>'kra', cfg->>'kpi_description',
    wt, (cfg->>'target_value')::numeric, 'score',
    cfg->>'scoring_rule', '{}'::jsonb, next_ord);
end $$;


/**
 * Turn ESMS on or off for one assignment.
 *
 * Owns the whole rebalance, because the two weights are one decision:
 * switching ESMS on and forgetting to take the 5% off core values
 * produces an assignment that adds up to 105% and cannot be submitted,
 * with an error message pointing at the wrong section.
 */
create or replace function set_esms(p_assignment_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a        kpi_assignments%rowtype;
  cfg      jsonb;
  esms_wt  numeric;
  next_ord int;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  -- The people who may edit the rows may set this. Anything already
  -- approved is locked, and goes through the revision request instead.
  if not (a.employee_id = current_employee_id()
          or manages_employee(a.employee_id)
          or is_hr_admin()) then
    raise exception 'You can only change your own KPI';
  end if;
  if a.status not in ('draft', 'rejected') then
    raise exception
      'This KPI is no longer editable (current: %). Request a revision instead.',
      a.status;
  end if;

  select value into cfg from app_settings where key = 'esms_row';
  if cfg is null then
    raise exception 'No esms_row configured in app_settings';
  end if;
  esms_wt := (cfg->>'weightage')::numeric;

  delete from kpi_assignment_items
  where assignment_id = p_assignment_id and section = 'esms';

  update kpi_assignments
  set esms_weight        = case when p_enabled then esms_wt else 0 end,
      -- 20 is the whole non-job-role block. ESMS takes its share of that
      -- and core values keeps the rest, so the total never moves.
      core_values_weight = case when p_enabled then 20 - esms_wt else 20 end
  where id = p_assignment_id;

  if p_enabled then
    select coalesce(max(sort_order), 0) + 1 into next_ord
    from kpi_assignment_items where assignment_id = p_assignment_id;

    insert into kpi_assignment_items (
      assignment_id, section, kra, kpi_description,
      weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
    values (
      p_assignment_id, 'esms',
      cfg->>'kra', cfg->>'kpi_description',
      esms_wt, (cfg->>'target_value')::numeric, 'score',
      cfg->>'scoring_rule', '{}'::jsonb, next_ord);
  end if;

  -- Restamped last, at whichever weight it now carries.
  perform apply_standard_core_values(p_assignment_id);
end $$;

grant execute on function set_esms(uuid, boolean) to authenticated;

comment on function set_esms(uuid, boolean) is
  'Adds or removes the standard ESMS row and rebalances core values with '
  'it, so the three sections always total 100%.';


-- ---------------------------------------------------------------------
-- 5. Validation now has three sections to satisfy.
-- ---------------------------------------------------------------------
create or replace function validate_assignment(p_assignment_id uuid)
returns table (ok boolean, message text)
language plpgsql stable as $$
declare
  a           kpi_assignments%rowtype;
  job_sum     numeric;
  core_sum    numeric;
  esms_sum    numeric;
  item_count  int;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then
    return query select false, 'Assignment not found'; return;
  end if;

  select
    coalesce(sum(weightage) filter (where section = 'job_role'), 0),
    coalesce(sum(weightage) filter (where section = 'core_values'), 0),
    coalesce(sum(weightage) filter (where section = 'esms'), 0),
    count(*)
  into job_sum, core_sum, esms_sum, item_count
  from kpi_assignment_items where assignment_id = p_assignment_id;

  if item_count = 0 then
    return query select false, 'No KPI rows have been added'; return;
  end if;

  -- Compared at full precision, reported at one decimal: rounding the
  -- comparison would let 79.999% pass as 80%.
  if job_sum <> a.job_role_weight then
    return query select false, format(
      'Job Role weightages total %s%%, they must total %s%%',
      round(job_sum, 1), round(a.job_role_weight, 1));
    return;
  end if;
  if core_sum <> a.core_values_weight then
    return query select false, format(
      'Core Values weightages total %s%%, they must total %s%%',
      round(core_sum, 1), round(a.core_values_weight, 1));
    return;
  end if;
  if esms_sum <> a.esms_weight then
    return query select false, format(
      'ESMS weightages total %s%%, they must total %s%%',
      round(esms_sum, 1), round(a.esms_weight, 1));
    return;
  end if;

  -- The three are set together by set_esms, so this can only fail if
  -- something wrote the columns directly. Caught here rather than
  -- discovered as a score that quietly does not reach 100.
  if a.job_role_weight + a.core_values_weight + a.esms_weight <> 100 then
    return query select false, format(
      'The sections total %s%%, they must total 100%%',
      round(a.job_role_weight + a.core_values_weight + a.esms_weight, 1));
    return;
  end if;

  return query select true, 'Valid';
end $$;


-- ---------------------------------------------------------------------
-- 6. The roll-up stops naming core values.
--
-- "Everything that is not the job role" is the rule it was always
-- expressing, and it keeps the reported figure at 80 / 20 whether that
-- 20 is one row or two.
-- ---------------------------------------------------------------------
create or replace function recompute_submission_totals(p_submission_id uuid)
returns void
language plpgsql
as $$
declare
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
  perform set_config('cyrix.system_write', 'on', true);

  select value into blend from app_settings where key = 'score_blend';
  self_w := coalesce((blend->>'self_weight')::numeric,    0.5);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 0.5);

  update kpi_submission_items i
  set
    self_score    = calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                   i.self_achieved, i.rule_params),
    manager_score = case
                      when i.manager_achieved is null then null
                      else calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                          i.manager_achieved, i.rule_params)
                    end,
    final_score   = case
                      when i.manager_achieved is null then null
                      else round(
                        self_w * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.self_achieved, i.rule_params)
                      + mgr_w  * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.manager_achieved, i.rule_params), 4)
                    end
  where i.submission_id = p_submission_id;

  update kpi_submissions s
  set
    self_job_role_score  = t.self_job,
    self_core_score      = t.self_core,
    self_total_score     = coalesce(t.self_job, 0) + coalesce(t.self_core, 0),
    mgr_job_role_score   = t.mgr_job,
    mgr_core_score       = t.mgr_core,
    mgr_total_score      = case when t.mgr_scored_rows = 0 then null
                           else coalesce(t.mgr_job, 0) + coalesce(t.mgr_core, 0) end,
    final_job_role_score = t.fin_job,
    final_core_score     = t.fin_core,
    final_total_score    = case when t.fin_scored_rows = 0 then null
                           else coalesce(t.fin_job, 0) + coalesce(t.fin_core, 0) end
  from (
    select
      sum(self_score)    filter (where section =  'job_role') as self_job,
      sum(self_score)    filter (where section <> 'job_role') as self_core,
      sum(manager_score) filter (where section =  'job_role') as mgr_job,
      sum(manager_score) filter (where section <> 'job_role') as mgr_core,
      sum(final_score)   filter (where section =  'job_role') as fin_job,
      sum(final_score)   filter (where section <> 'job_role') as fin_core,
      count(manager_score) as mgr_scored_rows,
      count(final_score)   as fin_scored_rows
    from kpi_submission_items
    where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id;

  perform set_config('cyrix.system_write', 'off', true);
end $$;


-- ---------------------------------------------------------------------
-- 7. Completeness on submit.
--
-- The check named job_role because that was the only section anyone
-- typed into. The real rule is "every row somebody enters by hand" —
-- core values are filled by the ratings trigger, everything else is not.
-- ---------------------------------------------------------------------
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
    and section <> 'core_values' and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  select count(*) into missing
  from core_value_ratings where submission_id = p_submission_id and self_rating is null;
  if missing > 0 then
    raise exception '% core value(s) have not been rated', missing;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'submitted', self_submitted_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'self_submitted', '{}'::jsonb);
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
    and section <> 'core_values' and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'scored', manager_scored_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored', '{}'::jsonb);
  return s;
end $$;


-- ---------------------------------------------------------------------
-- 8. Only negotiated targets carry forward.
--
-- 0014 inherits each row's target from the person's most recent earlier
-- month, which is right for a job role KRA — "40 visits" is agreed again
-- every month. It is wrong for the standard rows: ESMS is fixed at 100
-- and core values are a rating out of 100, so neither is a number
-- anybody sets. Inheriting them meant one edited month could quietly
-- move the denominator for the rest of the year.
--
-- The lookup is now scoped to the job role. Everything else takes the
-- assignment's value, every month, unchanged.
-- ---------------------------------------------------------------------
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

  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  select
    s.id, ai.id, ai.section, ai.kra, ai.kpi_description,
    ai.weightage,
    case when ai.section = 'job_role' then
      -- Most recent earlier month for the same KRA, else the baseline.
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

  perform log_audit('kpi_submission', s.id, 'opened',
                    jsonb_build_object('period', month1));
  return s;
end $$;


-- ---------------------------------------------------------------------
-- Self-test: build one of each, on a real employee, and roll it back.
-- ---------------------------------------------------------------------
do $$
declare
  emp     uuid;
  fy      text;
  aid     uuid;
  v       record;
  a       kpi_assignments%rowtype;
  n_esms  int;
  n_core  numeric;
begin
  select code into fy from financial_years where is_current;

  -- Somebody with no live assignment, so the one-live index is not hit.
  select e.id into emp from employees e
  where e.is_active and e.reporting_manager_id is not null
    -- Aliased ka, not a: `a` is a record variable in this block, and
    -- plpgsql would not know which of the two `a.employee_id` means.
    and not exists (
      select 1 from kpi_assignments ka
      where ka.employee_id = e.id and ka.financial_year = fy
        and ka.status in ('draft','pending_approval','active'))
  limit 1;
  if emp is null then
    raise notice '0024 self-test skipped — every active employee has a live KPI';
    return;
  end if;

  insert into kpi_assignments (employee_id, financial_year, status)
  values (emp, fy, 'draft') returning id into aid;

  -- The 80% of job role rows the person would define themselves.
  insert into kpi_assignment_items (
    assignment_id, section, kra, weightage, target_value, scoring_rule, sort_order)
  values (aid, 'job_role', 'Audit Planning & Execution', 80, 100, 'higher_capped', 1);

  -- ---- off: 80 + 20, no ESMS row -------------------------------------
  perform set_esms(aid, false);
  select * into a from kpi_assignments where id = aid;
  select count(*) into n_esms from kpi_assignment_items
  where assignment_id = aid and section = 'esms';
  select coalesce(sum(weightage), 0) into n_core from kpi_assignment_items
  where assignment_id = aid and section = 'core_values';

  if n_esms <> 0 or a.esms_weight <> 0 or a.core_values_weight <> 20 or n_core <> 20 then
    raise exception
      'ESMS off should be 0%% ESMS and 20%% core, got % row(s), %%% and %%%',
      n_esms, a.esms_weight, a.core_values_weight;
  end if;

  select * into v from validate_assignment(aid);
  if not v.ok then raise exception 'valid assignment rejected without ESMS: %', v.message; end if;

  -- ---- on: 80 + 5 + 15 ------------------------------------------------
  perform set_esms(aid, true);
  select * into a from kpi_assignments where id = aid;
  select count(*) into n_esms from kpi_assignment_items
  where assignment_id = aid and section = 'esms';
  select coalesce(sum(weightage), 0) into n_core from kpi_assignment_items
  where assignment_id = aid and section = 'core_values';

  if n_esms <> 1 then
    raise exception 'ESMS on should stamp exactly one row, got %', n_esms;
  end if;
  if a.esms_weight <> 5 or a.core_values_weight <> 15 or n_core <> 15 then
    raise exception
      'ESMS on should be 5%% ESMS and 15%% core, got %%% and %%% (rows %%%)',
      a.esms_weight, a.core_values_weight, n_core;
  end if;
  if a.job_role_weight <> 80 then
    raise exception 'the job role must not pay for ESMS: it is now %%%', a.job_role_weight;
  end if;

  select * into v from validate_assignment(aid);
  if not v.ok then raise exception 'valid assignment rejected with ESMS: %', v.message; end if;

  -- ---- and back off again, with no residue ----------------------------
  perform set_esms(aid, false);
  select count(*) into n_esms from kpi_assignment_items
  where assignment_id = aid and section = 'esms';
  select * into a from kpi_assignments where id = aid;
  if n_esms <> 0 or a.core_values_weight <> 20 then
    raise exception 'turning ESMS off left % row(s) and core at %%%',
      n_esms, a.core_values_weight;
  end if;

  -- ---- a section that does not add up is rejected ---------------------
  update kpi_assignments set esms_weight = 5 where id = aid;
  select * into v from validate_assignment(aid);
  if v.ok then
    raise exception 'an assignment totalling 105%% was accepted';
  end if;

  delete from kpi_assignments where id = aid;

  raise notice
    '0024 self-test passed — 80/20 without ESMS, 80/5/15 with it, '
    'reversible, and an unbalanced split is refused';
end $$;
