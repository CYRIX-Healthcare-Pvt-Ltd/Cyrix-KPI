-- =====================================================================
-- Cyrix KPI · 0146 · The software administrator edits one person's KPI
--
-- The user, 8 Oct: "need a new feature in SW_ADMIN under kpi tab, need a
-- option to edit individuals kpi … i search a ecode, then his kpi edit
-- option, then like we have that 3 option".
--
-- The three options are the template ones (0126): From now on, All
-- months keep the figures, All months start clean. sync_assignment_to_rows
-- is sync_assignment_to_template — generated from its live definition
-- (make_0146.mjs) — reading the rows given instead of a template's, so a
-- month is rewritten exactly as a template push rewrites it.
--
-- Both callable functions are the software administrator's alone, and
-- every edit leaves an audit line with the rows before and after.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_assignment_to_rows(p_assignment_id uuid, p_rows jsonb, p_mode text DEFAULT 'forward'::text)
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
  from (select 'job_role'::text as section,
               btrim(r ->> 'kra') as kra,
               nullif(btrim(coalesce(r ->> 'kpi_description', '')), '') as kpi_description,
               coalesce((r ->> 'weightage')::numeric, 0) as weightage,
               nullif(r ->> 'target_value', '')::numeric as target_value,
               nullif(btrim(coalesce(r ->> 'target_unit', '')), '') as target_unit,
               coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped') as scoring_rule,
               coalesce(r -> 'rule_params', '{}'::jsonb) as rule_params,
               case when jsonb_typeof(r -> 'alternates') = 'array' then r -> 'alternates' else '[]'::jsonb end as alternates,
               (row_number() over ())::int as sort_order
          from jsonb_array_elements(p_rows) r
         where btrim(coalesce(r ->> 'kra', '')) <> '') ti
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
    and lower(btrim(ai.kra)) = lower(btrim(ti.kra));

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, alternates, sort_order)
  select p_assignment_id, ti.section, ti.kra, ti.kpi_description, ti.weightage,
         ti.target_value, ti.target_unit, ti.scoring_rule, ti.rule_params,
         ti.alternates, ti.sort_order
  from (select 'job_role'::text as section,
               btrim(r ->> 'kra') as kra,
               nullif(btrim(coalesce(r ->> 'kpi_description', '')), '') as kpi_description,
               coalesce((r ->> 'weightage')::numeric, 0) as weightage,
               nullif(r ->> 'target_value', '')::numeric as target_value,
               nullif(btrim(coalesce(r ->> 'target_unit', '')), '') as target_unit,
               coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped') as scoring_rule,
               coalesce(r -> 'rule_params', '{}'::jsonb) as rule_params,
               case when jsonb_typeof(r -> 'alternates') = 'array' then r -> 'alternates' else '[]'::jsonb end as alternates,
               (row_number() over ())::int as sort_order
          from jsonb_array_elements(p_rows) r
         where btrim(coalesce(r ->> 'kra', '')) <> '') ti
  where not exists (
      select 1 from kpi_assignment_items ai
      where ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and lower(btrim(ai.kra)) = lower(btrim(ti.kra)));

  delete from kpi_assignment_items ai
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
    and not exists (
      select 1 from (select 'job_role'::text as section,
               btrim(r ->> 'kra') as kra,
               nullif(btrim(coalesce(r ->> 'kpi_description', '')), '') as kpi_description,
               coalesce((r ->> 'weightage')::numeric, 0) as weightage,
               nullif(r ->> 'target_value', '')::numeric as target_value,
               nullif(btrim(coalesce(r ->> 'target_unit', '')), '') as target_unit,
               coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped') as scoring_rule,
               coalesce(r -> 'rule_params', '{}'::jsonb) as rule_params,
               case when jsonb_typeof(r -> 'alternates') = 'array' then r -> 'alternates' else '[]'::jsonb end as alternates,
               (row_number() over ())::int as sort_order
          from jsonb_array_elements(p_rows) r
         where btrim(coalesce(r ->> 'kra', '')) <> '') ti
      where lower(btrim(ti.kra)) = lower(btrim(ai.kra)));

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
end $function$;
revoke execute on function public.sync_assignment_to_rows(uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- One person's KPI for the current year, found by E-code.
-- ---------------------------------------------------------------------
create or replace function public.admin_kpi_for(p_ecode text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  e  employees%rowtype;
  a  kpi_assignments%rowtype;
  fy text := (select code from financial_years where is_current limit 1);
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can edit somebody''s KPI here';
  end if;
  select * into e from employees where upper(ecode) = upper(btrim(coalesce(p_ecode, '')));
  if not found then
    raise exception 'There is nobody with the code %', upper(btrim(coalesce(p_ecode, '')));
  end if;
  select * into a from kpi_assignments
   where employee_id = e.id and financial_year = fy and status in ('active', 'pending_approval')
   order by created_at desc limit 1;
  return jsonb_build_object(
    'fy', fy,
    'employee', jsonb_build_object('id', e.id, 'ecode', e.ecode, 'full_name', e.full_name,
                                   'designation', e.designation, 'is_active', e.is_active),
    'assignment', case when a.id is null then null else jsonb_build_object(
        'id', a.id, 'status', a.status, 'job_role_weight', a.job_role_weight,
        'template', (select name from kpi_templates where id = a.source_template_id)) end,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
                         from kpi_assignment_items i
                        where i.assignment_id = a.id and i.section = 'job_role'), '[]'::jsonb),
    'months', coalesce((select jsonb_object_agg(status, n)
                          from (select status, count(*)::int n from kpi_submissions
                                 where assignment_id = a.id group by status) x), '{}'::jsonb));
end $function$;
revoke execute on function public.admin_kpi_for(text) from public, anon;
grant execute on function public.admin_kpi_for(text) to authenticated;

-- ---------------------------------------------------------------------
-- The edit, with how far back it goes.
-- ---------------------------------------------------------------------
create or replace function public.admin_edit_assignment(p_assignment_id uuid, p_rows jsonb, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a       kpi_assignments%rowtype;
  n       integer;
  total   numeric;
  job     numeric;
  twice   text;
  before  jsonb;
  months  integer;
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can edit somebody''s KPI here';
  end if;
  if coalesce(p_mode, '') not in ('forward', 'keep', 'clean') then
    raise exception 'Choose how far back the change goes';
  end if;
  select * into a from kpi_assignments where id = p_assignment_id for update;
  if not found then raise exception 'That KPI no longer exists'; end if;
  if a.status not in ('active', 'pending_approval') then
    raise exception 'Only a KPI in use can be edited here';
  end if;

  select count(*), coalesce(sum(coalesce((r ->> 'weightage')::numeric, 0)), 0) into n, total
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where btrim(coalesce(r ->> 'kra', '')) <> '';
  if n = 0 then raise exception 'A KPI needs at least one row'; end if;
  job := coalesce(a.job_role_weight, 80);
  if total <> job then
    raise exception 'The Job Role rows add up to %, and they must make %', trim_scale(total) || '%', trim_scale(job) || '%';
  end if;
  -- Months are matched to rows by KRA, so two rows of one name would be one row.
  select min(btrim(r ->> 'kra')) into twice
    from jsonb_array_elements(p_rows) r
   where btrim(coalesce(r ->> 'kra', '')) <> ''
   group by lower(btrim(r ->> 'kra')) having count(*) > 1 limit 1;
  if twice is not null then
    raise exception 'Two rows are both called "%" — give each its own name', twice;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kra', kra, 'weightage', weightage, 'target_value', target_value,
                                               'target_unit', target_unit, 'scoring_rule', scoring_rule)
                            order by sort_order), '[]'::jsonb)
    into before
    from kpi_assignment_items where assignment_id = a.id and section = 'job_role';

  months := coalesce(sync_assignment_to_rows(a.id, p_rows, p_mode), 0);
  update kpi_assignments set updated_at = now() where id = a.id;

  perform log_audit('kpi_assignment', a.id, 'admin_edited',
    jsonb_build_object('mode', p_mode, 'months', months, 'before', before, 'after', p_rows));
  return jsonb_build_object('months', months, 'mode', p_mode);
end $function$;
revoke execute on function public.admin_edit_assignment(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_edit_assignment(uuid, jsonb, text) to authenticated;
