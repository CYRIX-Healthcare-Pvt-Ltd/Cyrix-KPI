-- =====================================================================
-- Cyrix KPI  ·  0040  ·  One row, more than one thing it could measure
--
-- Some roles do a different job in different months. The work is worth
-- the same share of the year either way, but what is counted changes —
-- one target this month, a different one the next.
--
-- Today that cannot be written down. Two rows means twice the
-- weightage, and the year has to total 100; one row means the KPI
-- describes only half of what the person actually does, and every month
-- doing the other half scores against a target that does not apply.
--
-- So a row may carry alternatives: the same weightage, a different KRA,
-- parameter, target and scoring rule. Each month the person picks which
-- one was the work. Exactly one is in play at a time, which is why the
-- weightage never moves and the year still totals 100 without anything
-- in validate_assignment changing.
--
-- Held as jsonb on the row rather than as sibling rows. Sibling rows
-- would have to be excluded from the total, from open_submission's
-- copy, from the roll-ups and from the report — five places that each
-- have to remember a rule, which is five places for one of them to
-- forget it. A variant of a row is not a row.
-- =====================================================================

alter table kpi_assignment_items
  add column if not exists alternates jsonb not null default '[]'::jsonb;

alter table kpi_assignment_items
  drop constraint if exists kpi_assignment_items_alternates_shape;
alter table kpi_assignment_items
  add constraint kpi_assignment_items_alternates_shape
  check (
    jsonb_typeof(alternates) = 'array'
    -- Five is not a limit anybody will reach honestly. It is there so a
    -- bad client cannot put a megabyte on a row every screen reads.
    and jsonb_array_length(alternates) <= 5
  );

comment on column kpi_assignment_items.alternates is
  'Other things this row could measure in a given month — same '
  'weightage, different KRA and target. [{id, kra, kpi_description, '
  'target_value, target_unit, scoring_rule, rule_params}]. See '
  'use_alternate().';

-- Which one is in play this month. Null is the row as written.
alter table kpi_submission_items
  add column if not exists alternate_id text;

comment on column kpi_submission_items.alternate_id is
  'Which of the assignment row''s alternates this month is measuring. '
  'Null means the row as originally written.';


-- ---------------------------------------------------------------------
-- Switching a month to one of them.
--
-- A definer function because the guard freezes kra, scoring_rule and
-- rule_params for the year — correctly, since those are the agreed
-- contract and nobody should be able to edit their way to an easier
-- one. This is the sanctioned exception: not a new definition, but a
-- choice between definitions that were already agreed and approved.
-- ---------------------------------------------------------------------
create or replace function use_alternate(
  p_item_id      uuid,
  /** Null puts the row back to how it was written. */
  p_alternate_id text
)
returns kpi_submission_items
language plpgsql volatile security definer set search_path = public as $$
declare
  it  kpi_submission_items%rowtype;
  s   kpi_submissions%rowtype;
  ai  kpi_assignment_items%rowtype;
  alt jsonb;
  me  uuid := current_employee_id();
begin
  select * into it from kpi_submission_items where id = p_item_id;
  if not found then raise exception 'That row was not found'; end if;

  select * into s from kpi_submissions where id = it.submission_id;

  -- Same rule as editing a figure: the team member owns the month while
  -- it is theirs, the manager owns it once it has arrived.
  if s.employee_id = me then
    if s.status not in ('draft', 'returned') then
      raise exception 'This month is with your manager and cannot be changed';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status not in ('submitted', 'scored') then
      raise exception 'This month cannot be changed (current: %)', s.status;
    end if;
  elsif not is_hr_admin() then
    raise exception 'Not permitted';
  end if;

  if it.assignment_item_id is null then
    raise exception 'This row is not linked to a KPI, so it has no alternatives';
  end if;
  select * into ai from kpi_assignment_items where id = it.assignment_item_id;

  if p_alternate_id is null then
    alt := jsonb_build_object(
      'kra', ai.kra, 'kpi_description', ai.kpi_description,
      'target_value', ai.target_value, 'target_unit', ai.target_unit,
      'scoring_rule', ai.scoring_rule, 'rule_params', ai.rule_params);
  else
    select e into alt
    from jsonb_array_elements(ai.alternates) e
    where e->>'id' = p_alternate_id;
    if alt is null then
      raise exception 'That alternative is not on this KPI row';
    end if;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submission_items
  set kra             = coalesce(alt->>'kra', ai.kra),
      kpi_description = nullif(alt->>'kpi_description', ''),
      target_value    = nullif(alt->>'target_value', '')::numeric,
      target_unit     = nullif(alt->>'target_unit', ''),
      scoring_rule    = coalesce(alt->>'scoring_rule', ai.scoring_rule),
      rule_params     = coalesce(alt->'rule_params', '{}'::jsonb),
      alternate_id    = p_alternate_id,
      -- What was measured has changed, so a figure entered against the
      -- old one is not a smaller or larger version of this — it is an
      -- answer to a different question. Both go.
      self_achieved    = null,
      manager_achieved = null
  where id = p_item_id
  returning * into it;
  perform set_config('cyrix.system_write', 'off', true);

  -- The weightage is untouched on purpose: it is what makes an
  -- alternative an alternative rather than a second row, and it is why
  -- the year still totals 100 whichever one is chosen.
  perform recompute_submission_totals(it.submission_id);
  return it;
end $$;

grant execute on function use_alternate(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  ai      kpi_assignment_items%rowtype;
  before  jsonb;
  n       int;
begin
  select * into ai from kpi_assignment_items
  where section = 'job_role' order by sort_order limit 1;

  if ai.id is null then
    raise notice '0040 self-test skipped — no job role rows yet';
    return;
  end if;

  before := ai.alternates;

  -- The shape holds, and the ceiling bites.
  update kpi_assignment_items
  set alternates = jsonb_build_array(jsonb_build_object(
    'id', 'alt-selftest', 'kra', 'Self test',
    'target_value', 10, 'scoring_rule', 'higher_capped', 'rule_params', '{}'::jsonb))
  where id = ai.id;

  select jsonb_array_length(alternates) into n
  from kpi_assignment_items where id = ai.id;
  if n <> 1 then
    raise exception 'an alternative did not save';
  end if;

  begin
    update kpi_assignment_items
    set alternates = (
      select jsonb_agg(jsonb_build_object('id', 'x' || g, 'kra', 'x'))
      from generate_series(1, 6) g)
    where id = ai.id;
    update kpi_assignment_items set alternates = before where id = ai.id;
    raise exception 'six alternatives were accepted on one row';
  exception when check_violation then
    null;
  end;

  -- An object rather than an array must not get in either.
  begin
    update kpi_assignment_items set alternates = '{}'::jsonb where id = ai.id;
    update kpi_assignment_items set alternates = before where id = ai.id;
    raise exception 'a non-array was accepted as the alternatives list';
  exception when check_violation then
    null;
  end;

  update kpi_assignment_items set alternates = before where id = ai.id;

  raise notice
    '0040 self-test passed — alternatives save, cap at five, and must '
    'be an array';
end $$;
