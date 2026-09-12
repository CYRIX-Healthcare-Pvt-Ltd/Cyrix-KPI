-- =====================================================================
-- Cyrix KPI  ·  0123  ·  A template belongs to whoever wrote it
--
-- Every KPI correction in this company currently goes through a script
-- and a conversation: an Excel file arrives, somebody rehearses an
-- update against production, and eleven people's months are relinked by
-- hand. The managers who own those KPIs cannot do any of it themselves.
--
-- Three things were missing, and this adds them.
--
-- 1. Templates flowed the wrong way. visible_kpi_templates walked UP
--    from the caller, so a junior could see and apply their own
--    manager's KPI — a Zonal Manager template offered to an engineer —
--    while the senior manager could not see what the managers below
--    them had already written. It now walks DOWN: mine, and everybody
--    below me at any depth. HR's company templates are unchanged.
--
--    Saranya sees Adrian's and Sreemon's. Adrian sees Sreemon's.
--    Sreemon sees his own. Nobody sees their own manager's.
--
-- 2. Nobody could see who was using one. source_template_id has been on
--    kpi_assignments since 0093 and is set on ten rows out of 816,
--    because only the setup screen's "start from a template" ever set
--    it. Applying a template now sets it, and the count comes back with
--    the template: "23 people".
--
-- 3. There was no way to give a template to more than one person.
--    bulk_assign_kpi is the software administrator's, takes one code at
--    a time, and deletes and re-inserts the rows — which is what keeps
--    severing filed months from their KPI. apply_template_to takes a
--    list of codes, updates the rows in place so a filed month keeps
--    its link and its figures, and goes straight to active: the manager
--    doing the assigning is the person who would approve it.
--
-- Who may assign to whom: anybody in the caller's downline, at any
-- depth, or anybody at all for HR. manages_employee() stays direct
-- reports only — approving a month belongs to the person who signs it
-- off, and that is not the same question.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Everybody below somebody.
-- ---------------------------------------------------------------------
create or replace function public.downline_of(p_manager_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive down as (
    select e.id, 1 as depth
    from employees e
    where e.reporting_manager_id = p_manager_id
      and p_manager_id is not null
    union all
    select e.id, d.depth + 1
    from employees e
    join down d on e.reporting_manager_id = d.id
    -- A guard rather than a rule about the business. Reporting lines are
    -- a tree right up until somebody's manager is set to one of their
    -- own reportees, and then this runs until the connection dies.
    where d.depth < 12
  )
  select id from down
$$;

comment on function public.downline_of(uuid) is
  'Every employee under this one, at any depth, excluding themselves.';


create or replace function public.is_in_my_downline(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from downline_of(current_employee_id()) d where d = p_employee_id
  )
$$;

comment on function public.is_in_my_downline(uuid) is
  'True for anybody under the caller at any depth. Wider than '
  'manages_employee(), which is direct reports and is what approvals use.';

grant execute on function public.downline_of(uuid) to authenticated;
grant execute on function public.is_in_my_downline(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- What the templates screen lists.
--
-- Dropped and recreated rather than replaced: in_use is a new column on
-- the return type. The grants go with the drop and are restored below.
-- ---------------------------------------------------------------------
drop function if exists public.visible_kpi_templates(text);

create function public.visible_kpi_templates(p_fy text)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_name text,
  owner_ecode text,
  is_company boolean,
  is_mine boolean,
  item_count bigint,
  /** Active KPIs this year that came from this template. */
  in_use bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, job_role_id from employees where auth_user_id = auth.uid()
  ),
  below as (
    select downline_of((select id from me)) as id
  )
  select
    t.id,
    t.name,
    t.owner_id,
    o.full_name,
    o.ecode,
    t.owner_id is null,
    t.owner_id = (select id from me),
    (select count(*) from kpi_template_items i
      where i.template_id = t.id and i.section = 'job_role'),
    (select count(*) from kpi_assignments a
      where a.source_template_id = t.id
        and a.financial_year = p_fy
        and a.status in ('active', 'pending_approval'))
  from kpi_templates t
  left join employees o on o.id = t.owner_id
  where t.status = 'active'
    and coalesce(t.financial_year, p_fy) = p_fy
    and (
      -- Mine.
      t.owner_id = (select id from me)
      -- Or written by somebody below me, at any depth.
      or t.owner_id in (select id from below)
      -- Or HR's, for the job role the caller actually holds. Unchanged.
      or (t.owner_id is null
          and t.job_role_id is not null
          and t.job_role_id = (select job_role_id from me))
    )
  order by
    -- Mine first, then the managers below me by name, then HR's.
    (t.owner_id is null),
    (t.owner_id is distinct from (select id from me)),
    o.full_name nulls first,
    t.name;
$$;

comment on function public.visible_kpi_templates(text) is
  'The templates a manager may use: their own, anybody''s below them at '
  'any depth, and HR''s for their own job role. Each with how many rows '
  'it carries and how many people are on it. See migration 0123.';

grant execute on function public.visible_kpi_templates(text) to authenticated;
grant execute on function public.visible_kpi_templates(text) to service_role;


-- ---------------------------------------------------------------------
-- Giving a template to a list of people.
--
-- Rows are matched by KRA and updated in place, never deleted and
-- re-inserted. That single difference is what keeps a month that has
-- already been filed attached to the KPI it was filed against —
-- bulk_assign_kpi's delete severs kpi_submission_items.assignment_item_id
-- on every scored month it touches, and repairing that by hand is most
-- of what these scripts have been for.
--
-- Straight to active, with the caller recorded as the approver. A
-- manager assigning a KPI to their own team is the same person who
-- would be asked to approve it, and asking them twice is a queue of 23
-- rubber stamps between the team and a month they can fill in.
-- ---------------------------------------------------------------------
create or replace function public.apply_template_to(
  p_template_id uuid,
  p_codes       text[],
  p_fy          text default null,
  p_starts_from date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := current_employee_id();
  fy        text := coalesce(p_fy, (select f.code from financial_years f where f.is_current));
  fy_from   date;
  tpl       kpi_templates%rowtype;
  job_total numeric;
  raw       text;
  code_in   text;
  emp       record;
  a         kpi_assignments%rowtype;
  v         record;
  results   jsonb := '[]'::jsonb;
  n_done    int := 0;
  n_skip    int := 0;
begin
  if me is null then
    raise exception 'Only a signed-in employee can assign a template';
  end if;

  select f.starts_on into fy_from from financial_years f where f.code = fy;
  if fy_from is null then
    raise exception 'No financial year called %', fy;
  end if;

  select * into tpl from kpi_templates where id = p_template_id;
  if not found or tpl.status <> 'active' then
    raise exception 'That template no longer exists';
  end if;

  -- The same reach as the list: mine, somebody's below me, or HR's.
  if not (tpl.owner_id = me
          or tpl.owner_id is null
          or is_in_my_downline(tpl.owner_id)
          or is_hr_admin()) then
    raise exception 'That template is not yours to assign';
  end if;

  select coalesce(sum(weightage), 0) into job_total
  from kpi_template_items
  where template_id = p_template_id and section = 'job_role';

  if job_total <= 0 then
    raise exception 'That template has no job role rows to assign';
  end if;

  foreach raw in array coalesce(p_codes, '{}'::text[]) loop
    code_in := upper(btrim(coalesce(raw, '')));
    continue when code_in = '';

    select e.id, e.ecode, e.full_name, e.is_active, e.date_of_joining
      into emp
    from employees e
    where upper(btrim(e.ecode)) = code_in
    limit 1;

    if not found then
      results := results || jsonb_build_object(
        'code', code_in, 'status', 'skipped',
        'detail', 'No employee has that code');
      n_skip := n_skip + 1;
      continue;
    end if;

    if not emp.is_active then
      results := results || jsonb_build_object(
        'code', emp.ecode, 'name', emp.full_name, 'status', 'skipped',
        'detail', 'Not an active employee');
      n_skip := n_skip + 1;
      continue;
    end if;

    if not (is_in_my_downline(emp.id) or is_hr_admin()) then
      results := results || jsonb_build_object(
        'code', emp.ecode, 'name', emp.full_name, 'status', 'skipped',
        'detail', 'Not in your team');
      n_skip := n_skip + 1;
      continue;
    end if;

    select * into a
    from kpi_assignments
    where employee_id = emp.id and financial_year = fy
    limit 1;

    if not found then
      insert into kpi_assignments (
        employee_id, financial_year, status, source_template_id,
        job_role_weight, core_values_weight, esms_weight, starts_from,
        submitted_at, submitted_by, approved_at, approved_by)
      values (
        emp.id, fy, 'active', p_template_id,
        job_total, 100 - job_total, 0,
        -- The month they joined, where that lands inside the year.
        -- Starting everybody at April is how somebody who joined in
        -- August comes to owe twelve months.
        coalesce(
          p_starts_from,
          greatest(fy_from, date_trunc('month', emp.date_of_joining)::date),
          fy_from),
        now(), me, now(), me)
      returning * into a;
    else
      update kpi_assignments
      set status             = 'active',
          source_template_id = p_template_id,
          job_role_weight    = job_total,
          -- ESMS is carved out of the core block for the people who
          -- carry it, so the core weight is what is left rather than a
          -- constant.
          core_values_weight = 100 - job_total - kpi_assignments.esms_weight,
          starts_from        = coalesce(p_starts_from, kpi_assignments.starts_from, fy_from),
          approved_at        = coalesce(kpi_assignments.approved_at, now()),
          approved_by        = coalesce(kpi_assignments.approved_by, me),
          rejection_reason   = null
      where id = a.id
      returning * into a;
    end if;

    -- The rows this KPI already has, brought up to the template.
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
    where ai.assignment_id = a.id
      and ai.section = 'job_role'
      and ti.template_id = p_template_id
      and ti.section = 'job_role'
      and lower(btrim(ai.kra)) = lower(btrim(ti.kra));

    -- The rows it does not.
    insert into kpi_assignment_items (
      assignment_id, section, kra, kpi_description, weightage,
      target_value, target_unit, scoring_rule, rule_params, alternates, sort_order)
    select a.id, ti.section, ti.kra, ti.kpi_description, ti.weightage,
           ti.target_value, ti.target_unit, ti.scoring_rule, ti.rule_params,
           ti.alternates, ti.sort_order
    from kpi_template_items ti
    where ti.template_id = p_template_id
      and ti.section = 'job_role'
      and not exists (
        select 1 from kpi_assignment_items ai
        where ai.assignment_id = a.id
          and ai.section = 'job_role'
          and lower(btrim(ai.kra)) = lower(btrim(ti.kra)));

    -- And the rows the template does not have.
    delete from kpi_assignment_items ai
    where ai.assignment_id = a.id
      and ai.section = 'job_role'
      and not exists (
        select 1 from kpi_template_items ti
        where ti.template_id = p_template_id
          and ti.section = 'job_role'
          and lower(btrim(ti.kra)) = lower(btrim(ai.kra)));

    -- The core values block is the company's, not the template's.
    perform apply_standard_core_values(a.id);
    -- Open months follow the KPI. Filed ones do not, and the count
    -- comes back so the caller is told rather than finding out.
    perform refresh_open_submissions(a.id);

    select * into v from validate_assignment(a.id);

    perform log_audit('kpi_assignment', a.id, 'template_applied',
      jsonb_build_object(
        'template', tpl.name,
        'template_id', p_template_id,
        'rows', (select count(*) from kpi_assignment_items
                 where assignment_id = a.id and section = 'job_role')));

    results := results || jsonb_build_object(
      'code', emp.ecode,
      'name', emp.full_name,
      'status', case when v.ok then 'assigned' else 'assigned_with_warning' end,
      'detail', case when v.ok then null else v.message end,
      'starts_from', to_char(a.starts_from, 'Mon-YY'),
      'filed_months', (
        select count(*) from kpi_submissions s
        where s.employee_id = emp.id
          and s.financial_year = fy
          and s.status <> 'draft'));
    n_done := n_done + 1;
  end loop;

  return jsonb_build_object(
    'financial_year', fy,
    'template', tpl.name,
    'assigned', n_done,
    'skipped', n_skip,
    'results', results);
end $$;

comment on function public.apply_template_to(uuid, text[], text, date) is
  'Gives a template to a list of employee codes: the caller''s downline, '
  'or anybody for HR. Rows are updated in place so filed months keep '
  'their link, and the KPI goes straight to active with the caller as '
  'the approver. See migration 0123.';

grant execute on function public.apply_template_to(uuid, text[], text, date) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: the downline is the downline, and the list obeys the rule
-- it was rewritten for — nothing from above the caller.
-- ---------------------------------------------------------------------
do $$
declare
  mgr      uuid;
  mine     int;
  expected int;
  caller   record;
  bad      int;
begin
  -- 1. downline_of against the same set worked out longhand.
  select e.id into mgr
  from employees e
  join employees r on r.reporting_manager_id = e.id
  group by e.id
  order by count(*) desc
  limit 1;

  select count(*) into mine from downline_of(mgr);

  with recursive down as (
    select id from employees where reporting_manager_id = mgr
    union all
    select e.id from employees e join down d on e.reporting_manager_id = d.id
  )
  select count(*) into expected from down;

  if mine <> expected then
    raise exception 'downline_of returned % where the tree has %', mine, expected;
  end if;
  if mine = 0 then
    raise exception 'the busiest manager in the company has no reportees';
  end if;

  if exists (select 1 from downline_of(mgr) d where d = mgr) then
    raise exception 'downline_of includes the manager themselves';
  end if;

  -- 2. Nothing from above the caller, for somebody who owns templates
  --    and has a manager of their own.
  select e.id, e.auth_user_id, e.reporting_manager_id into caller
  from employees e
  where e.auth_user_id is not null
    and e.reporting_manager_id is not null
    and exists (select 1 from kpi_templates t where t.owner_id = e.id and t.status = 'active')
  limit 1;

  if caller.id is null then
    raise notice '0123 self-test: no template owner with a manager to test visibility with';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', caller.auth_user_id, 'role', 'authenticated')::text, true);

    select count(*) into bad
    from visible_kpi_templates((select f.code from financial_years f where f.is_current)) v
    where v.owner_id is not null
      and v.owner_id <> caller.id
      and not exists (select 1 from downline_of(caller.id) d where d = v.owner_id);

    if bad > 0 then
      raise exception '% template(s) visible that are neither mine nor from below me', bad;
    end if;

    perform set_config('request.jwt.claims', '', true);
  end if;

  raise notice '0123 self-test passed (% below the busiest manager; nothing visible from above a caller)', mine;
end $$;
