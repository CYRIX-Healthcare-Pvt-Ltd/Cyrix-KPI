-- =====================================================================
-- Cyrix KPI · 0148 · Edit a KPI matches each row by its own id
--
-- The user, 8 Oct, at Jerin E J (E2233): "Two rows are both called
-- 'Payment & Advance Management'". A KRA heads several KPIs — Jerin's
-- Treasury & Working Capital heads six — and 101 KPIs in use repeat a
-- KRA. Matching rows by KRA (as a template push does) made one row of
-- them, so the edit refused them. The same KRA and KPI twice is still
-- refused ("kra text + kpi txt shouldnt be repeating").
--
-- Now each row carries the id of the KPI row it is, and every month is
-- matched by its link to that row (kpi_submission_items.assignment_item_id).
-- A month row whose link was lost earlier (321 job role rows) is first
-- relinked by KRA and KPI together, then by KRA where the KRA is the only
-- one of its name; one that still cannot be matched stops the edit rather
-- than lose its figures.
--
-- Months in reach — From now on: draft and returned; All months: every
-- one — take the job role rows, the ESMS row and the core value weights,
-- and are scored again. The two other ways in (template push, approval)
-- are unchanged.
-- =====================================================================

create or replace function public.sync_assignment_rows_by_id(p_assignment_id uuid, p_rows jsonb, p_mode text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  prev_write text;
  sm         record;
  touched    integer := 0;
  lost       integer;
begin
  if p_mode not in ('forward', 'keep', 'clean') then
    raise exception 'Unknown mode "%"', p_mode;
  end if;
  prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);

  /* ---- months whose link was lost: relink before anything moves --- */
  update kpi_submission_items si
     set assignment_item_id = ai.id
    from kpi_submissions s, kpi_assignment_items ai
   where s.assignment_id = p_assignment_id and si.submission_id = s.id
     and si.section = 'job_role' and si.assignment_item_id is null
     and ai.assignment_id = p_assignment_id and ai.section = 'job_role'
     and lower(btrim(ai.kra)) = lower(btrim(si.kra))
     and lower(btrim(coalesce(ai.kpi_description, ''))) = lower(btrim(coalesce(si.kpi_description, '')))
     and (select count(*) from kpi_assignment_items x
           where x.assignment_id = p_assignment_id and x.section = 'job_role'
             and lower(btrim(x.kra)) = lower(btrim(si.kra))
             and lower(btrim(coalesce(x.kpi_description, ''))) = lower(btrim(coalesce(si.kpi_description, '')))) = 1;
  update kpi_submission_items si
     set assignment_item_id = ai.id
    from kpi_submissions s, kpi_assignment_items ai
   where s.assignment_id = p_assignment_id and si.submission_id = s.id
     and si.section = 'job_role' and si.assignment_item_id is null
     and ai.assignment_id = p_assignment_id and ai.section = 'job_role'
     and lower(btrim(ai.kra)) = lower(btrim(si.kra))
     and (select count(*) from kpi_assignment_items x
           where x.assignment_id = p_assignment_id and x.section = 'job_role'
             and lower(btrim(x.kra)) = lower(btrim(si.kra))) = 1;
  select count(*) into lost
    from kpi_submission_items si join kpi_submissions s on s.id = si.submission_id
   where s.assignment_id = p_assignment_id and si.section = 'job_role' and si.assignment_item_id is null
     and (p_mode <> 'forward' or s.status in ('draft', 'returned'))
     and p_mode <> 'clean';
  if lost > 0 then
    raise exception '% month row(s) of this KPI are no longer linked to a KPI row and could not be matched — choose All months, start clean, or ask for the months to be looked at', lost;
  end if;

  /* ---- the KPI's own rows, by id ---------------------------------- */
  delete from kpi_assignment_items ai
   where ai.assignment_id = p_assignment_id and ai.section = 'job_role'
     and not exists (select 1 from jsonb_array_elements(p_rows) r
                      where nullif(r ->> 'id', '') is not null and (r ->> 'id')::uuid = ai.id);

  update kpi_assignment_items ai
     set kra             = btrim(r ->> 'kra'),
         kpi_description = nullif(btrim(coalesce(r ->> 'kpi_description', '')), ''),
         weightage       = coalesce((r ->> 'weightage')::numeric, 0),
         target_value    = nullif(r ->> 'target_value', '')::numeric,
         target_unit     = nullif(btrim(coalesce(r ->> 'target_unit', '')), ''),
         scoring_rule    = coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped'),
         rule_params     = coalesce(r -> 'rule_params', '{}'::jsonb),
         alternates      = case when jsonb_typeof(r -> 'alternates') = 'array' then r -> 'alternates' else '[]'::jsonb end,
         sort_order      = o.n::int
    from jsonb_array_elements(p_rows) with ordinality o(r, n)
   where ai.assignment_id = p_assignment_id and ai.section = 'job_role'
     and nullif(r ->> 'id', '') is not null and (r ->> 'id')::uuid = ai.id;

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, alternates, sort_order)
  select p_assignment_id, 'job_role', btrim(r ->> 'kra'),
         nullif(btrim(coalesce(r ->> 'kpi_description', '')), ''),
         coalesce((r ->> 'weightage')::numeric, 0),
         nullif(r ->> 'target_value', '')::numeric,
         nullif(btrim(coalesce(r ->> 'target_unit', '')), ''),
         coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped'),
         coalesce(r -> 'rule_params', '{}'::jsonb),
         case when jsonb_typeof(r -> 'alternates') = 'array' then r -> 'alternates' else '[]'::jsonb end,
         o.n::int
    from jsonb_array_elements(p_rows) with ordinality o(r, n)
   where btrim(coalesce(r ->> 'kra', '')) <> ''
     and not exists (select 1 from kpi_assignment_items ai
                      where ai.assignment_id = p_assignment_id and ai.section = 'job_role'
                        and nullif(r ->> 'id', '') is not null and (r ->> 'id')::uuid = ai.id);

  -- The core values block is the company's: restamped at the weight it now carries.
  perform apply_standard_core_values(p_assignment_id);

  /* ---- and the months in reach ------------------------------------ */
  for sm in
    select id, employee_id, period_month from kpi_submissions
     where assignment_id = p_assignment_id
       and (p_mode <> 'forward' or status in ('draft', 'returned'))
  loop
    if p_mode = 'clean' then
      delete from kpi_submission_items where submission_id = sm.id and section = 'job_role';
    end if;

    update kpi_submission_items si
       set kra = ai.kra, kpi_description = ai.kpi_description, weightage = ai.weightage,
           target_unit = ai.target_unit, scoring_rule = ai.scoring_rule,
           rule_params = ai.rule_params, sort_order = ai.sort_order
      from kpi_assignment_items ai
     where si.submission_id = sm.id and si.section = 'job_role'
       and ai.id = si.assignment_item_id and ai.section = 'job_role';

    delete from kpi_submission_items si
     where si.submission_id = sm.id and si.section = 'job_role'
       and not exists (select 1 from kpi_assignment_items ai
                        where ai.assignment_id = p_assignment_id and ai.section = 'job_role'
                          and ai.id = si.assignment_item_id);

    insert into kpi_submission_items (
      submission_id, assignment_item_id, section, kra, kpi_description,
      weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
    select sm.id, ai.id, 'job_role', ai.kra, ai.kpi_description, ai.weightage,
           coalesce((select pi.target_value from kpi_submission_items pi
                       join kpi_submissions ps on ps.id = pi.submission_id
                      where ps.employee_id = sm.employee_id and ps.period_month < sm.period_month
                        and pi.assignment_item_id = ai.id
                      order by ps.period_month desc limit 1), ai.target_value),
           ai.target_unit, ai.scoring_rule, ai.rule_params, ai.sort_order
      from kpi_assignment_items ai
     where ai.assignment_id = p_assignment_id and ai.section = 'job_role'
       and not exists (select 1 from kpi_submission_items si
                        where si.submission_id = sm.id and si.assignment_item_id = ai.id);

    -- ESMS: the row the KPI has, or none.
    delete from kpi_submission_items si
     where si.submission_id = sm.id and si.section = 'esms'
       and not exists (select 1 from kpi_assignment_items ai where ai.assignment_id = p_assignment_id and ai.section = 'esms');
    insert into kpi_submission_items (
      submission_id, assignment_item_id, section, kra, kpi_description, weightage, target_value, target_unit,
      scoring_rule, rule_params, sort_order)
    select sm.id, ai.id, 'esms', ai.kra, ai.kpi_description, ai.weightage, ai.target_value, ai.target_unit,
           ai.scoring_rule, ai.rule_params, ai.sort_order
      from kpi_assignment_items ai
     where ai.assignment_id = p_assignment_id and ai.section = 'esms'
       and not exists (select 1 from kpi_submission_items si where si.submission_id = sm.id and si.section = 'esms');

    -- Core values: the restamped rows, by KRA (one of each), at their new weights.
    update kpi_submission_items si
       set assignment_item_id = ai.id, weightage = ai.weightage
      from kpi_assignment_items ai
     where si.submission_id = sm.id and si.section in ('core_values', 'esms')
       and ai.assignment_id = p_assignment_id and ai.section = si.section
       and lower(btrim(ai.kra)) = lower(btrim(si.kra));

    perform recompute_submission_totals(sm.id);
    touched := touched + 1;
  end loop;

  -- Months out of reach keep everything, but their core rows point at the restamped ones.
  update kpi_submission_items si
     set assignment_item_id = ai.id
    from kpi_assignment_items ai, kpi_submissions s
   where s.assignment_id = p_assignment_id and si.submission_id = s.id
     and si.section = 'core_values' and ai.assignment_id = p_assignment_id and ai.section = 'core_values'
     and lower(btrim(ai.kra)) = lower(btrim(si.kra)) and si.assignment_item_id is distinct from ai.id;

  perform set_config('cyrix.system_write', prev_write, true);
  return touched;
end $function$;
revoke execute on function public.sync_assignment_rows_by_id(uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The edit: rows by id, no refusal of a repeated KRA, ESMS as in 0147.
-- ---------------------------------------------------------------------
create or replace function public.admin_edit_assignment(p_assignment_id uuid, p_rows jsonb, p_mode text, p_esms boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a        kpi_assignments%rowtype;
  n        integer;
  total    numeric;
  job      numeric;
  before   jsonb;
  dup      text;
  months   integer;
  was_esms boolean;
  flip     boolean;
  cfg      jsonb;
  esms_wt  numeric;
  next_ord integer;
  prev     text;
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
  if exists (select 1 from jsonb_array_elements(p_rows) r where btrim(coalesce(r ->> 'kra', '')) = '') then
    raise exception 'Every row needs its KRA';
  end if;
  -- A KRA may head several KPIs; the same KRA and KPI twice is one row typed twice (the user, 8 Oct).
  select min(btrim(r ->> 'kra') || ' — ' || coalesce(nullif(btrim(r ->> 'kpi_description'), ''), '(no KPI)')) into dup
    from jsonb_array_elements(p_rows) r
   group by lower(btrim(r ->> 'kra')), lower(btrim(coalesce(r ->> 'kpi_description', '')))
  having count(*) > 1 limit 1;
  if dup is not null then
    raise exception 'Two rows are both "%" — give each its own KPI', dup;
  end if;
  job := coalesce(a.job_role_weight, 80);
  if total <> job then
    raise exception 'The Job Role rows add up to %, and they must make %', trim_scale(total) || '%', trim_scale(job) || '%';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kra', kra, 'kpi', kpi_description, 'weightage', weightage,
                                               'target_value', target_value, 'scoring_rule', scoring_rule)
                            order by sort_order), '[]'::jsonb)
    into before
    from kpi_assignment_items where assignment_id = a.id and section = 'job_role';

  was_esms := coalesce(a.esms_weight, 0) > 0;
  flip := p_esms is not null and p_esms <> was_esms;

  prev := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);
  if flip then
    select value into cfg from app_settings where key = 'esms_row';
    if cfg is null then raise exception 'No esms_row configured in app_settings'; end if;
    esms_wt := (cfg ->> 'weightage')::numeric;
    delete from kpi_assignment_items where assignment_id = a.id and section = 'esms';
    update kpi_assignments
       set esms_weight        = case when p_esms then esms_wt else 0 end,
           core_values_weight = case when p_esms then 20 - esms_wt else 20 end
     where id = a.id;
    if p_esms then
      select coalesce(max(sort_order), 0) + 1 into next_ord from kpi_assignment_items where assignment_id = a.id;
      insert into kpi_assignment_items (
        assignment_id, section, kra, kpi_description, weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
      values (a.id, 'esms', cfg ->> 'kra', cfg ->> 'kpi_description', esms_wt,
              (cfg ->> 'target_value')::numeric, 'score', cfg ->> 'scoring_rule', '{}'::jsonb, next_ord);
    end if;
  end if;

  months := coalesce(sync_assignment_rows_by_id(a.id, p_rows, p_mode), 0);

  perform set_config('cyrix.system_write', prev, true);
  update kpi_assignments set updated_at = now() where id = a.id;

  perform log_audit('kpi_assignment', a.id, 'admin_edited',
    jsonb_build_object('mode', p_mode, 'months', months, 'before', before, 'after', p_rows,
                       'esms', case when flip then jsonb_build_object('from', was_esms, 'to', p_esms) end));
  return jsonb_build_object('months', months, 'mode', p_mode, 'esms', case when flip then p_esms else was_esms end);
end $function$;
revoke execute on function public.admin_edit_assignment(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.admin_edit_assignment(uuid, jsonb, text, boolean) to authenticated;

-- 0146's KRA-matched version is no longer used by anything.
drop function if exists public.sync_assignment_to_rows(uuid, jsonb, text);
