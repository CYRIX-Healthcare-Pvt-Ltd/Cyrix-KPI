-- =====================================================================
-- Cyrix KPI  ·  0093  ·  A manager can keep a KPI template
--
-- "Use my role's template" has been a dead card since the day it was
-- built. It reads kpi_templates by job_role_id, HR is the only role that
-- may write one, and exactly one has ever existed -- the Service
-- Engineer rows seeded in 0007. Everybody else opens the setup screen,
-- sees "No template for your job role yet", and types eight rows from
-- scratch that their manager has already agreed with four other people.
--
-- The person who knows what an engineer's KPI should say is the manager
-- who approves eight of them a year, not HR. So a template gains an
-- OWNER, and an owned template is visible to everybody below its owner
-- in the reporting line -- not just the owner's direct reports. A
-- divisional manager writes "Service Engineer" once and every engineer
-- in the division can start from it, including the ones two rungs down
-- who report to somebody else.
--
-- What an owner is, precisely:
--
--   owner_id null      a company template. HR's, keyed to a job role,
--                      offered to the people holding that role. Exactly
--                      as it has always worked.
--   owner_id set       a manager's. Named freely -- "Engineer", "Senior
--                      technician" -- and offered down their line.
--
-- Nothing about assignments changes. A template is still copied onto a
-- person and then edited freely, so a template that changes next year
-- cannot reach backwards into an appraisal that used it. That is the
-- rule 0002 set and this does not touch it.
-- =====================================================================

alter table kpi_templates
  add column if not exists owner_id uuid references employees(id) on delete cascade;

comment on column kpi_templates.owner_id is
  'The manager who keeps this template. Null means a company template, '
  'which is HR''s and is offered by job role.';

create index if not exists idx_templates_owner
  on kpi_templates(owner_id, financial_year) where owner_id is not null;

/*
 * One name per owner per year.
 *
 * Case- and space-insensitive, because "Engineer" and "engineer " are
 * one template as far as the manager picking from a dropdown is
 * concerned, and two rows called the same thing is a dropdown nobody can
 * choose from.
 *
 * Only for owned templates. The company ones are already covered by the
 * unique (job_role_id, financial_year, version) 0002 put on them, and
 * that constraint is not one this touches.
 */
create unique index if not exists idx_templates_owner_name
  on kpi_templates(owner_id, financial_year, lower(btrim(name)))
  where owner_id is not null;


-- ---------------------------------------------------------------------
-- Who may write one.
--
-- Was HR only. Now HR, plus anybody editing a template they own. The
-- `owner_id is not null` half matters in both directions: without it in
-- USING, a manager could edit HR's company templates the moment
-- current_employee_id() went null; without it in WITH CHECK, they could
-- create one.
-- ---------------------------------------------------------------------
drop policy if exists templates_write on kpi_templates;
create policy templates_write on kpi_templates for all to authenticated
using (
  is_hr_admin()
  or (owner_id is not null and owner_id = current_employee_id())
)
with check (
  is_hr_admin()
  or (owner_id is not null and owner_id = current_employee_id())
);

drop policy if exists template_items_write on kpi_template_items;
create policy template_items_write on kpi_template_items for all to authenticated
using (
  is_hr_admin()
  or exists (
    select 1 from kpi_templates t
    where t.id = template_id
      and t.owner_id is not null
      and t.owner_id = current_employee_id()
  )
)
with check (
  is_hr_admin()
  or exists (
    select 1 from kpi_templates t
    where t.id = template_id
      and t.owner_id is not null
      and t.owner_id = current_employee_id()
  )
);


-- ---------------------------------------------------------------------
-- The templates one person may start from.
--
-- Walks UP from the caller rather than down from each owner: an employee
-- has one manager and a manager has forty reports, so upwards is one row
-- per level and seven hops at most. The same shape as is_above() in
-- 0082, and for the same reason.
--
-- Definer, because the chain crosses rows employees_read does not allow
-- the caller to see -- their manager's manager is not their business,
-- and this needs to know who it is without showing them.
-- ---------------------------------------------------------------------
create or replace function public.visible_kpi_templates(p_fy text)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_name text,
  owner_ecode text,
  /** True for HR's job-role templates, which belong to nobody. */
  is_company boolean,
  /** Mine to rename and delete, or somebody else's to use. */
  is_mine boolean,
  item_count bigint
)
language sql
stable security definer
set search_path to 'public'
as $function$
  -- RECURSIVE leads the whole chain, not just the member that recurses:
  -- Postgres reads it as a property of the WITH clause.
  with recursive me as (
    select id, job_role_id from employees where auth_user_id = auth.uid()
  ),
  -- The caller and everybody above them. The caller is in it on purpose:
  -- your own templates are the ones you are most likely to want.
  line as (
    select id, reporting_manager_id from employees where id = (select id from me)
    union all
    select e.id, e.reporting_manager_id
    from employees e join line l on e.id = l.reporting_manager_id
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
      where i.template_id = t.id and i.section = 'job_role')
  from kpi_templates t
  left join employees o on o.id = t.owner_id
  where t.status = 'active'
    and coalesce(t.financial_year, p_fy) = p_fy
    and (
      -- A manager's, from anywhere at or above the caller.
      t.owner_id in (select id from line)
      -- Or HR's, for the job role the caller actually holds. Unchanged
      -- from what the setup screen has always offered.
      or (t.owner_id is null
          and t.job_role_id is not null
          and t.job_role_id = (select job_role_id from me))
    )
  order by (t.owner_id is null), o.full_name nulls first, t.name;
$function$;


-- ---------------------------------------------------------------------
-- Saving one.
--
-- A function rather than an insert from the browser, because "replace
-- the rows of this template" is three statements that must not half
-- happen -- and because the name clash has to come back as a sentence
-- somebody can read rather than as a unique-violation on an index they
-- have never heard of.
--
-- Job role rows only. Core values and ESMS are identical for everyone
-- who has them and are stamped on by set_esms when the KPI is saved, so
-- a template carrying its own copy would be a second opinion about the
-- standard 20% -- which is exactly the drift 0085 was written to stop.
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

  -- Said here rather than left to the index, so the message names the
  -- template that is in the way.
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
    -- Ownership is re-checked rather than assumed: this is a definer
    -- function, so the row policy that would otherwise stop it is not
    -- in force here.
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
    target_value, target_unit, scoring_rule, rule_params, sort_order
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
    row_number() over ()
  from jsonb_array_elements(p_rows) r
  where btrim(coalesce(r ->> 'kra', '')) <> '';

  return tpl;
end $$;


-- ---------------------------------------------------------------------
-- Saving one from a KPI that is being approved.
--
-- The moment a manager agrees somebody's rows is the moment those rows
-- are worth keeping, and it is the only moment when they are on screen
-- already agreed. Anything else asks the manager to retype a KPI they
-- have just read.
--
-- Targets come along. They are the one thing a template does not
-- promise -- the next person's numbers are their own -- but they are a
-- far better starting point than an empty column, and the setup screen
-- makes every one of them editable before anything is submitted.
-- ---------------------------------------------------------------------
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

  -- The caller has to be somewhere above this person, or HR. is_above()
  -- covers the whole line, so a divisional manager can keep a template
  -- from a KPI two rungs below them.
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
      'rule_params', i.rule_params
    ) order by i.sort_order
  ), '[]'::jsonb)
  into rows
  from kpi_assignment_items i
  where i.assignment_id = p_assignment_id and i.section = 'job_role';

  return save_team_template(p_name, a.financial_year, rows, null);
end $$;


revoke all on function public.visible_kpi_templates(text) from public, anon;
revoke all on function public.save_team_template(text, text, jsonb, uuid) from public, anon;
revoke all on function public.template_from_assignment(uuid, text) from public, anon;
grant execute on function public.visible_kpi_templates(text) to authenticated;
grant execute on function public.save_team_template(text, text, jsonb, uuid) to authenticated;
grant execute on function public.template_from_assignment(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Builds a three-rung line -- boss, manager, engineer -- and checks the
-- thing the whole migration is for: that a template written at the top
-- reaches the bottom, and that one written to the side reaches nobody.
-- ---------------------------------------------------------------------
do $$
declare
  boss uuid; mgr uuid; eng uuid; outsider uuid;
  boss_u uuid := gen_random_uuid();
  eng_u  uuid := gen_random_uuid();
  out_u  uuid := gen_random_uuid();
  tpl uuid; n int; hijacked boolean;
begin
  -- Four fresh people rather than real ones, so the test says nothing
  -- about whoever happens to be first in the table.
  --
  -- With real auth rows behind them, because linking an employee to a
  -- login raises a BEMMP profile whose id points at auth.users -- an
  -- invented uuid is refused there before this test reaches its point.
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  )
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', u.mail, now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
         '', '', '', '', '', '', '', ''
  from (values
    (boss_u, 'zz93a@cyrix.probe'),
    (eng_u,  'zz93c@cyrix.probe'),
    (out_u,  'zz93d@cyrix.probe')
  ) as u(id, mail);

  insert into employees (ecode, full_name, is_active, auth_user_id)
  values ('ZZ93A', 'Probe boss', true, boss_u) returning id into boss;
  insert into employees (ecode, full_name, is_active, reporting_manager_id)
  values ('ZZ93B', 'Probe manager', true, boss) returning id into mgr;
  insert into employees (ecode, full_name, is_active, reporting_manager_id, auth_user_id)
  values ('ZZ93C', 'Probe engineer', true, mgr, eng_u) returning id into eng;
  insert into employees (ecode, full_name, is_active, auth_user_id)
  values ('ZZ93D', 'Probe outsider', true, out_u) returning id into outsider;

  -- The boss writes one.
  perform set_config('request.jwt.claims',
    json_build_object('sub', boss_u, 'role', 'authenticated')::text, true);
  tpl := save_team_template('Probe engineer template', '2026-27', jsonb_build_array(
    jsonb_build_object('kra', 'Response time', 'kpi_description', 'within 48h',
                       'weightage', 40, 'target_value', 95, 'scoring_rule', 'higher_capped'),
    jsonb_build_object('kra', 'Closure rate', 'kpi_description', 'calls closed',
                       'weightage', 40, 'target_value', 90, 'scoring_rule', 'higher_capped')
  ), null);

  select count(*) into n from kpi_template_items where template_id = tpl;
  if n <> 2 then raise exception 'Saved % rows, expected 2', n; end if;

  -- Core values were not smuggled in. The standard 20% belongs to
  -- set_esms and a template must not carry a second opinion about it.
  if exists (select 1 from kpi_template_items
             where template_id = tpl and section <> 'job_role') then
    raise exception 'A template picked up a non job-role row';
  end if;

  -- Two rungs down, and it is there.
  perform set_config('request.jwt.claims',
    json_build_object('sub', eng_u, 'role', 'authenticated')::text, true);
  select count(*) into n from visible_kpi_templates('2026-27') where id = tpl;
  if n <> 1 then
    raise exception 'The engineer cannot see their boss''s template';
  end if;
  if exists (select 1 from visible_kpi_templates('2026-27')
             where id = tpl and (is_mine or not (owner_ecode = 'ZZ93A'))) then
    raise exception 'The engineer was told the template was theirs, or unattributed';
  end if;

  -- Somebody outside the line, and it is not.
  perform set_config('request.jwt.claims',
    json_build_object('sub', out_u, 'role', 'authenticated')::text, true);
  if exists (select 1 from visible_kpi_templates('2026-27') where id = tpl) then
    raise exception 'A template leaked outside its owner''s reporting line';
  end if;

  -- Downward only. The engineer keeping a template of their own must not
  -- put it in front of the two people above them: a manager opening the
  -- dropdown should see what their line agreed, not everything anybody
  -- underneath has ever saved.
  perform set_config('request.jwt.claims',
    json_build_object('sub', eng_u, 'role', 'authenticated')::text, true);
  perform save_team_template('Probe own notes', '2026-27', jsonb_build_array(
    jsonb_build_object('kra', 'Mine', 'weightage', 80, 'scoring_rule', 'higher_capped')
  ), null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', boss_u, 'role', 'authenticated')::text, true);
  if exists (select 1 from visible_kpi_templates('2026-27')
             where name = 'Probe own notes') then
    raise exception 'A template written below the caller was offered to them';
  end if;

  -- And the engineer cannot rewrite it. Checked through the policy
  -- rather than the function, because that is the door a browser knocks
  -- on directly -- which means actually becoming `authenticated` for the
  -- statement. A migration runs as the owner, and the owner bypasses
  -- every policy on the table, so a test that skips this proves nothing.
  perform set_config('request.jwt.claims',
    json_build_object('sub', eng_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update kpi_templates set name = 'Hijacked' where id = tpl;
  hijacked := found;
  execute 'reset role';
  if hijacked then
    raise exception 'A reportee rewrote a template belonging to their manager';
  end if;

  -- Same name twice is refused, and says which name.
  perform set_config('request.jwt.claims',
    json_build_object('sub', boss_u, 'role', 'authenticated')::text, true);
  begin
    perform save_team_template('probe engineer template ', '2026-27',
      jsonb_build_array(jsonb_build_object('kra', 'X', 'weightage', 80,
                                           'scoring_rule', 'higher_capped')), null);
    raise exception 'A duplicate template name was accepted';
  exception when others then
    if sqlerrm !~ 'already have a template called' then raise; end if;
  end;

  raise notice '0093 self-test passed (a template reaches the line below it and nobody else)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
