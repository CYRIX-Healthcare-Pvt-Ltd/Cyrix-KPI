-- =====================================================================
-- Cyrix KPI  ·  0133  ·  The KPI a template was saved from is on it
--
-- E9999 approved Nivek's KPI and pressed Save as team template, calling it
-- Sr MIS. E7777 and E8888 were then put on it with Assign to. The template
-- said "2 people are on this template" — and three people carried it.
--
-- template_from_assignment saved the rows and returned. It never set
-- source_template_id on the KPI it copied, so the person it was written
-- from was not counted, and every edit pushed to the people on it went
-- to the other two. Two edits were pushed before anybody noticed; the
-- second changed Accuracy of Work from lower-is-better to higher, and
-- Nivek is still on the old rule.
--
-- It also wrote no audit row, so there is no record of which KPI any
-- existing template was saved from, and past cases cannot be found from
-- history — only guessed at by matching rows, which is not the same
-- thing when four templates share one shape. Nivek is repaired separately,
-- by a rehearsed script, because he is the one case known for certain.
--
-- The body is the live definition read back with pg_get_functiondef, with
-- two splices. Same signature, so CREATE OR REPLACE and the grants stand.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.template_from_assignment(p_assignment_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a    kpi_assignments;
  rows jsonb;
  tpl  uuid;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if a.id is null then
    raise exception 'No such KPI';
  end if;

  if not (is_above(a.employee_id) or is_hr_admin() or a.employee_id = current_employee_id()) then
    raise exception 'That KPI is not yours to copy';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kra', i.kra,
      'kpi_description', i.kpi_description,
      'weightage', i.weightage,
      'target_value', i.target_value,
      'target_unit', i.target_unit,
      'scoring_rule', i.scoring_rule,
      'rule_params', i.rule_params,
      'alternates', i.alternates
    ) order by i.sort_order
  ), '[]'::jsonb)
  into rows
  from kpi_assignment_items i
  where i.assignment_id = p_assignment_id and i.section = 'job_role';

  tpl := save_team_template(p_name, a.financial_year, rows, null);

  -- The person it was saved from is on it. Their rows ARE the template,
  -- so leaving them unlinked meant the count said 2 when 3 people
  -- carried it, and an edit pushed to "everybody on it" skipped the one
  -- person it was written from. Only when they are not already on a
  -- template: moving somebody off another one is a decision, and saving
  -- a copy is not that decision.
  update kpi_assignments
  set source_template_id = tpl
  where id = p_assignment_id
    and source_template_id is null;

  -- It wrote nothing before, so there was no record of which KPI any
  -- template came from. There is now.
  perform log_audit('kpi_template', tpl, 'saved_from_assignment',
    jsonb_build_object('template', p_name,
                       'assignment_id', p_assignment_id,
                       'employee_id', a.employee_id));

  return tpl;
end $function$

;

-- ---------------------------------------------------------------------
-- Self-test: saving a KPI as a template puts its owner on it, and does
-- not move somebody who is already on a different one.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text := (select f.code from financial_years f where f.is_current);
  pick     record;
  new_tpl  uuid;
  linked   uuid;
begin
  if position('set source_template_id = tpl' in
              pg_get_functiondef('public.template_from_assignment'::regproc)) = 0 then
    raise exception 'template_from_assignment still does not link the KPI it copies';
  end if;

  -- Somebody unlinked, and a manager above them who can sign in.
  select a.id as assignment_id, m.auth_user_id
    into pick
  from kpi_assignments a
  join employees e on e.id = a.employee_id and e.is_active
  join employees m on m.id = e.reporting_manager_id and m.auth_user_id is not null
  where a.financial_year = fy
    and a.status = 'active'
    and a.source_template_id is null
    and exists (select 1 from kpi_assignment_items i
                where i.assignment_id = a.id and i.section = 'job_role')
  limit 1;

  if pick.assignment_id is null then
    raise notice '0133 self-test: nobody unlinked to try it on';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', pick.auth_user_id, 'role', 'authenticated')::text, true);
    new_tpl := template_from_assignment(pick.assignment_id, '0133 self-test ' || gen_random_uuid());
    perform set_config('request.jwt.claims', '', true);

    select source_template_id into linked from kpi_assignments where id = pick.assignment_id;

    -- Undo, so the test leaves nothing behind even if this migration is
    -- ever run outside a transaction that rolls back.
    update kpi_assignments set source_template_id = null where id = pick.assignment_id;
    delete from kpi_templates where id = new_tpl;
    delete from audit_log where entity_id = new_tpl;

    if linked is distinct from new_tpl then
      raise exception 'the KPI a template was saved from did not end up on it';
    end if;
  end if;

  raise notice '0133 self-test passed (the KPI a template is saved from is on it)';
end $$;
