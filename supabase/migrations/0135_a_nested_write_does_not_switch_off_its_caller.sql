-- =====================================================================
-- Cyrix KPI  ·  0135  ·  A nested write does not switch off its caller
--
-- A manager approving a revised KPI got "The KRA, weightage and scoring
-- rule are fixed for the year" — Anoop Raj approving Sandhya Govind's,
-- who has two open months.
--
-- approve_assignment calls refresh_open_submissions, which switches the
-- system-write flag on so the item guard lets the KPI's own rows arrive,
-- and then, per month, calls recompute_submission_totals — which switches
-- the same flag on at its start and OFF at its end. So the first month
-- went through, the flag came back off, and the second month's update met
-- the guard as if a user had typed it. One open month never showed it;
-- two or more always did.
--
-- sync_assignment_to_template (0126) has the identical shape, and would
-- have failed the same way on anybody with more than one month.
--
-- Each of the three now remembers what its caller had and puts that
-- back, instead of forcing the flag off. Bodies are the live definitions
-- with only those lines changed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.recompute_submission_totals(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  prev_write text;
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
  prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);

  select value into blend from app_settings where key = 'score_blend';
  -- The fallback is the policy, not the old policy.
  --
  -- These defaulted to 0.5/0.5, which was right until 0095 made the
  -- manager's figure the score. The stored row says 0/1 and is what
  -- actually runs, so nothing is wrong today -- but a fallback is a
  -- promise about what happens when the row is missing, and this one
  -- promised to go back to averaging. Deleting a settings row would have
  -- silently rescored the company back to a rule management withdrew.
  self_w := coalesce((blend->>'self_weight')::numeric,    0);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 1);

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
    self_esms_score      = t.self_esms,
    self_core_score      = t.self_core,
    self_total_score     = coalesce(t.self_job, 0) + coalesce(t.self_esms, 0)
                         + coalesce(t.self_core, 0),
    mgr_job_role_score   = t.mgr_job,
    mgr_esms_score       = t.mgr_esms,
    mgr_core_score       = t.mgr_core,
    mgr_total_score      = case when t.mgr_scored_rows = 0 then null
                           else coalesce(t.mgr_job, 0) + coalesce(t.mgr_esms, 0)
                              + coalesce(t.mgr_core, 0) end,
    final_job_role_score = t.fin_job,
    final_esms_score     = t.fin_esms,
    final_core_score     = t.fin_core,
    final_total_score    = case when t.fin_scored_rows = 0 then null
                           else coalesce(t.fin_job, 0) + coalesce(t.fin_esms, 0)
                              + coalesce(t.fin_core, 0) end
  from (
    select
      sum(self_score)    filter (where section = 'job_role')    as self_job,
      sum(self_score)    filter (where section = 'esms')        as self_esms,
      sum(self_score)    filter (where section = 'core_values') as self_core,
      sum(manager_score) filter (where section = 'job_role')    as mgr_job,
      sum(manager_score) filter (where section = 'esms')        as mgr_esms,
      sum(manager_score) filter (where section = 'core_values') as mgr_core,
      sum(final_score)   filter (where section = 'job_role')    as fin_job,
      sum(final_score)   filter (where section = 'esms')        as fin_esms,
      sum(final_score)   filter (where section = 'core_values') as fin_core,
      count(manager_score) as mgr_scored_rows,
      count(final_score)   as fin_scored_rows
    from kpi_submission_items
    where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id;

  perform set_config('cyrix.system_write', prev_write, true);
end $function$
;

CREATE OR REPLACE FUNCTION public.refresh_open_submissions(p_assignment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prev_write text;
  s        kpi_submissions%rowtype;
  n        integer;
  touched  integer := 0;
begin
  -- guard_submission_item_columns refuses changes to the KRA, weightage
  -- and scoring rule -- correctly, since those are the year's agreed
  -- contract and not something an end user may edit mid-month. This is
  -- the KPI itself arriving, which is the one thing that may move them.
  prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
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

  perform set_config('cyrix.system_write', prev_write, true);
  return touched;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_assignment_to_template(p_assignment_id uuid, p_template_id uuid, p_mode text DEFAULT 'forward'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prev_write text;
  a       kpi_assignments%rowtype;
  s       record;
  touched integer := 0;
begin
  if p_mode not in ('forward', 'keep', 'clean') then
    raise exception 'Unknown mode "%"', p_mode;
  end if;

  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  -- The definition columns are guarded against end users; this is the
  -- KPI itself arriving, which is the one thing that may move them.
  prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);

  /* ---- the assignment's own rows ---------------------------------- */
  update kpi_assignment_items ai
  set kpi_description = ti.kpi_description,
      weightage       = ti.weightage,
      target_value    = ti.target_value,
      target_unit     = ti.target_unit,
      scoring_rule    = ti.scoring_rule,
      rule_params     = ti.rule_params,
      alternates      = ti.alternates,
      sort_order      = ti.sort_order
  from kpi_template_items ti
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
    and ti.template_id = p_template_id
    and ti.section = 'job_role'
    and lower(btrim(ai.kra)) = lower(btrim(ti.kra));

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, alternates, sort_order)
  select p_assignment_id, ti.section, ti.kra, ti.kpi_description, ti.weightage,
         ti.target_value, ti.target_unit, ti.scoring_rule, ti.rule_params,
         ti.alternates, ti.sort_order
  from kpi_template_items ti
  where ti.template_id = p_template_id
    and ti.section = 'job_role'
    and not exists (
      select 1 from kpi_assignment_items ai
      where ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and lower(btrim(ai.kra)) = lower(btrim(ti.kra)));

  delete from kpi_assignment_items ai
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
    and not exists (
      select 1 from kpi_template_items ti
      where ti.template_id = p_template_id
        and ti.section = 'job_role'
        and lower(btrim(ti.kra)) = lower(btrim(ai.kra)));

  -- The core values block is the company's, not the template's.
  perform apply_standard_core_values(p_assignment_id);

  /*
    And the link to it, on every month, in every mode.

    apply_standard_core_values deletes the assignment's core row and
    writes a fresh one, so its id changes — and kpi_submission_items
    points at that id ON DELETE SET NULL. Every filed month therefore
    came out of here with its core-values row severed from the KPI,
    which is the exact damage this function exists to avoid, caused by
    the one call that looked harmless.

    Relinking is not a content change: the row is the same row, and
    nothing about what was assessed moves. So it runs for filed months
    too, where it also repairs whatever earlier uploads severed.
  */
  -- Aliased sm, not s: s is the loop's record variable below and a
  -- plpgsql variable shadows a table alias of the same name.
  update kpi_submission_items si
  set assignment_item_id = ai.id
  from kpi_assignment_items ai, kpi_submissions sm
  where sm.assignment_id = p_assignment_id
    and si.submission_id = sm.id
    and si.section = 'core_values'
    and ai.assignment_id = p_assignment_id
    and ai.section = 'core_values'
    and si.assignment_item_id is distinct from ai.id;

  /* ---- and the months --------------------------------------------- */
  if p_mode = 'forward' then
    -- Draft and returned only. Exactly what refresh_open_submissions
    -- has always done, and it relinks as it goes.
    touched := coalesce(refresh_open_submissions(p_assignment_id), 0);
  else
    for s in
      select id, status from kpi_submissions where assignment_id = p_assignment_id
    loop
      if p_mode = 'clean' then
        -- Nothing filled in: the month starts again on the new KPI.
        delete from kpi_submission_items
        where submission_id = s.id and section = 'job_role';
      end if;

      -- Matched by KRA, so a row that survives the edit keeps its
      -- figures, its monthly target and its link.
      update kpi_submission_items si
      set assignment_item_id = ai.id,
          kpi_description    = ai.kpi_description,
          weightage          = ai.weightage,
          target_unit        = ai.target_unit,
          scoring_rule       = ai.scoring_rule,
          rule_params        = ai.rule_params,
          sort_order         = ai.sort_order
      from kpi_assignment_items ai
      where si.submission_id = s.id
        and si.section = 'job_role'
        and ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and lower(btrim(si.kra)) = lower(btrim(ai.kra));

      insert into kpi_submission_items (
        submission_id, assignment_item_id, section, kra, kpi_description,
        weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
      select s.id, ai.id, ai.section, ai.kra, ai.kpi_description, ai.weightage,
             ai.target_value, ai.target_unit, ai.scoring_rule, ai.rule_params,
             ai.sort_order
      from kpi_assignment_items ai
      where ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and not exists (
          select 1 from kpi_submission_items si
          where si.submission_id = s.id
            and si.section = 'job_role'
            and lower(btrim(si.kra)) = lower(btrim(ai.kra)));

      delete from kpi_submission_items si
      where si.submission_id = s.id
        and si.section = 'job_role'
        and not exists (
          select 1 from kpi_assignment_items ai
          where ai.assignment_id = p_assignment_id
            and ai.section = 'job_role'
            and lower(btrim(ai.kra)) = lower(btrim(si.kra)));

      perform recompute_submission_totals(s.id);
      touched := touched + 1;
    end loop;
  end if;

  perform set_config('cyrix.system_write', prev_write, true);
  return touched;
end $function$
;

do $$
begin
  if position('prev_write' in pg_get_functiondef('public.recompute_submission_totals'::regproc)) = 0 then
    raise exception 'recompute_submission_totals still forces the flag off';
  end if;
  raise notice '0135 self-test passed (nested writes restore their caller''s flag)';
end $$;
