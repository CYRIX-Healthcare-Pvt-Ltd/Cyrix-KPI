-- =====================================================================
-- Cyrix KPI  ·  0094  ·  A template carries its alternatives too
--
-- 0093 gave a manager somewhere to keep a KPI, and dropped part of it on
-- the way in. An assignment row can carry alternatives -- other things
-- that same row measures in some months, sharing its weightage (0040) --
-- and template rows had nowhere to put them. So "Save as team template"
-- on an approved KPI kept the rows and quietly lost the variants, and
-- the next person to use the template had to know they were missing and
-- retype them.
--
-- Which is the worse half of the bug: a template that is visibly empty
-- gets filled in, and one that is silently incomplete gets submitted.
--
-- Same column, same shape and the same five-row ceiling as the
-- assignment table, so the two cannot drift into disagreeing about what
-- an alternative is.
-- =====================================================================

alter table kpi_template_items
  add column if not exists alternates jsonb not null default '[]'::jsonb;

alter table kpi_template_items
  drop constraint if exists kpi_template_items_alternates_shape;
alter table kpi_template_items
  add constraint kpi_template_items_alternates_shape
  check (
    jsonb_typeof(alternates) = 'array'
    and jsonb_array_length(alternates) <= 5
  );

comment on column kpi_template_items.alternates is
  'Other things this row could measure in a given month — same '
  'weightage, different KRA and target. The same shape as '
  'kpi_assignment_items.alternates, because a template row becomes one.';


-- ---------------------------------------------------------------------
-- Both writers, so neither drops them.
-- ---------------------------------------------------------------------
create or replace function public.save_team_template(
  p_name text,
  p_fy text,
  p_rows jsonb,
  p_template_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me      uuid := current_employee_id();
  clean   text := btrim(coalesce(p_name, ''));
  tpl     uuid := p_template_id;
  n       int;
begin
  if me is null then
    raise exception 'Only a signed-in employee can save a template';
  end if;
  if clean = '' then
    raise exception 'Give the template a name';
  end if;
  if length(clean) > 60 then
    raise exception 'That name is too long — 60 characters at most';
  end if;

  select count(*) into n from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb));
  if n = 0 then
    raise exception 'A template needs at least one row';
  end if;

  if exists (
    select 1 from kpi_templates t
    where t.owner_id = me
      and t.financial_year = p_fy
      and lower(btrim(t.name)) = lower(clean)
      and (tpl is null or t.id <> tpl)
  ) then
    raise exception 'You already have a template called "%" this year', clean;
  end if;

  if tpl is null then
    insert into kpi_templates (
      name, owner_id, created_by, financial_year, status, version, job_role_id
    ) values (clean, me, me, p_fy, 'active', 1, null)
    returning id into tpl;
  else
    update kpi_templates
    set name = clean, updated_at = now()
    where id = tpl and owner_id = me;
    if not found then
      raise exception 'That template is not yours to change';
    end if;
    delete from kpi_template_items where template_id = tpl;
  end if;

  insert into kpi_template_items (
    template_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, alternates, sort_order
  )
  select
    tpl,
    'job_role',
    btrim(r ->> 'kra'),
    nullif(btrim(coalesce(r ->> 'kpi_description', '')), ''),
    coalesce((r ->> 'weightage')::numeric, 0),
    nullif(r ->> 'target_value', '')::numeric,
    nullif(btrim(coalesce(r ->> 'target_unit', '')), ''),
    coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped'),
    coalesce(r -> 'rule_params', '{}'::jsonb),
    -- Anything but an array is treated as none rather than refused: the
    -- check constraint would take the whole save down over a field the
    -- person filling in the form never sees.
    case when jsonb_typeof(r -> 'alternates') = 'array'
         then r -> 'alternates' else '[]'::jsonb end,
    row_number() over ()
  from jsonb_array_elements(p_rows) r
  where btrim(coalesce(r ->> 'kra', '')) <> '';

  return tpl;
end $$;


create or replace function public.template_from_assignment(
  p_assignment_id uuid,
  p_name text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  a    kpi_assignments;
  rows jsonb;
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

  return save_team_template(p_name, a.financial_year, rows, null);
end $$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- The route that lost them is the one worth testing: a real assignment
-- row with an alternative on it, kept as a template, read back.
-- ---------------------------------------------------------------------
do $$
declare
  mgr uuid; tm uuid; mgr_u uuid := gen_random_uuid();
  assign uuid; tpl uuid; alts jsonb; n int;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    mgr_u, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'zz94a@cyrix.probe', now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', '', '', '', '', ''
  );

  insert into employees (ecode, full_name, is_active, auth_user_id)
  values ('ZZ94A', 'Probe manager', true, mgr_u) returning id into mgr;
  insert into employees (ecode, full_name, is_active, reporting_manager_id)
  values ('ZZ94B', 'Probe engineer', true, mgr) returning id into tm;

  insert into kpi_assignments (employee_id, financial_year, status)
  values (tm, '2026-27', 'draft') returning id into assign;

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description, weightage,
    target_value, scoring_rule, alternates, sort_order
  ) values (
    assign, 'job_role', 'Installations', 'units installed', 80, 12,
    'higher_capped',
    jsonb_build_array(jsonb_build_object(
      'id', 'alt-probe', 'kra', 'Servicing', 'kpi_description', 'units serviced',
      'target_value', 30, 'scoring_rule', 'higher_capped', 'rule_params', '{}'::jsonb)),
    1
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', mgr_u, 'role', 'authenticated')::text, true);
  tpl := template_from_assignment(assign, 'Probe engineer template');

  select alternates into alts from kpi_template_items where template_id = tpl;
  if jsonb_array_length(coalesce(alts, '[]'::jsonb)) <> 1 then
    raise exception 'The alternative did not survive being kept as a template';
  end if;
  if alts -> 0 ->> 'kra' <> 'Servicing' then
    raise exception 'The alternative came back as %', alts -> 0 ->> 'kra';
  end if;

  -- And a row saved with none is an empty array, never null: every
  -- reader treats it as a list, and null is not one.
  perform save_team_template('Probe plain', '2026-27', jsonb_build_array(
    jsonb_build_object('kra', 'Plain', 'weightage', 80, 'scoring_rule', 'higher_capped')
  ), null);
  select count(*) into n from kpi_template_items i
  join kpi_templates t on t.id = i.template_id
  where t.name = 'Probe plain' and i.alternates = '[]'::jsonb;
  if n <> 1 then
    raise exception 'A row with no alternatives did not come back as an empty list';
  end if;

  raise notice '0094 self-test passed (alternatives survive being kept as a template)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
