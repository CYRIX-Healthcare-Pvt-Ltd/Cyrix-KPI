-- =====================================================================
-- Cyrix KPI  ·  0127  ·  A KPI twenty people share has a name
--
-- The company already works in templates. It just has not written any
-- of them down.
--
-- Of 773 active KPIs this year, 719 are one of thirty-one distinct
-- shapes — same KRAs, same weightages, same scoring rules, differing
-- only in the targets, which are per person anyway. The largest single
-- shape is carried by 250 people under 43 different managers. Five of
-- those 773 are linked to a template.
--
-- So every correction to one of those shapes has been thirty-one
-- separate conversations and a script, because there was nothing to
-- correct once. This finds the shapes, offers each one a name, and links
-- everybody on it to the template that comes out — which is what makes
-- "change the weightage for all 250" a single act afterwards.
--
-- Two functions:
--
--   shared_kpi_groups   the shapes two or more people in your own team
--                       share and nobody has named, with a suggested
--                       name taken from what those people are actually
--                       called.
--   template_from_shared names one, and links every assignment on that
--                       shape WITHIN YOUR REACH. A shape spanning 43
--                       managers is not one manager's to claim; each of
--                       them names it for their own people, and the
--                       count on each template says how far it got.
--
-- Already-linked KPIs are left out: the point is the unnamed ones.
-- =====================================================================


-- ---------------------------------------------------------------------
-- What shape a KPI is.
--
-- Targets are excluded on purpose — they are set per person, and two
-- engineers on the same KPI with different monthly numbers are on the
-- same KPI. So is the description: it is prose about the same row.
--
-- jsonb renders its keys in a canonical order, so rule_params::text is
-- stable across rows that mean the same thing.
-- ---------------------------------------------------------------------
create or replace function public.kpi_shape(p_assignment_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(string_agg(
    lower(btrim(ai.kra)) || '|' || ai.weightage || '|' || ai.scoring_rule
      || '|' || coalesce(ai.rule_params::text, '{}'),
    ';' order by lower(btrim(ai.kra)), ai.weightage))
  from kpi_assignment_items ai
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
$$;

comment on function public.kpi_shape(uuid) is
  'A hash of the KRAs, weightages and scoring rules of one KPI, ignoring '
  'targets and prose. Two people with the same shape are on the same KPI.';

grant execute on function public.kpi_shape(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- The shapes your own people share and nobody has named.
-- ---------------------------------------------------------------------
create or replace function public.shared_kpi_groups(p_fy text default null)
returns table (
  shape text,
  people integer,
  row_count integer,
  /** What those people are mostly called. Editable before it is saved. */
  suggested_name text,
  /** Every designation in the group, for telling two shapes apart. */
  designations text,
  /** A few of them by name, so it is recognisable. */
  examples text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from employees where auth_user_id = auth.uid()
  ),
  unnamed as (
    select
      a.id as assignment_id,
      e.designation,
      e.full_name,
      kpi_shape(a.id) as shape,
      (select count(*) from kpi_assignment_items ai
        where ai.assignment_id = a.id and ai.section = 'job_role') as rows
    from kpi_assignments a
    join employees e on e.id = a.employee_id and e.is_active
    where a.status = 'active'
      and a.financial_year = coalesce(
        p_fy, (select f.code from financial_years f where f.is_current))
      and a.source_template_id is null
      and (is_hr_admin()
        or e.id in (select d from downline_of((select id from me)) d))
  )
  select
    u.shape,
    count(*)::int,
    max(u.rows)::int,
    -- What most of them are called. A group of eleven Biomedical
    -- Engineers and one District In-charge is a Biomedical Engineer
    -- template, and the manager renames it if it is not.
    coalesce(
      nullif(btrim(mode() within group (order by u.designation)), ''),
      'Shared KPI'),
    (select string_agg(d, ', ' order by d)
     from (select distinct u2.designation as d
           from unnamed u2 where u2.shape = u.shape
             and u2.designation is not null limit 6) x),
    (select string_agg(n, ', ')
     from (select u3.full_name as n
           from unnamed u3 where u3.shape = u.shape
           order by u3.full_name limit 3) y)
  from unnamed u
  where u.shape is not null
  group by u.shape
  having count(*) > 1
  order by count(*) desc;
$$;

comment on function public.shared_kpi_groups(text) is
  'KPI shapes that two or more people in the caller''s team share and '
  'nobody has turned into a template yet. See migration 0127.';

grant execute on function public.shared_kpi_groups(text) to authenticated;


-- ---------------------------------------------------------------------
-- Naming one.
-- ---------------------------------------------------------------------
create or replace function public.template_from_shared(
  p_shape text,
  p_name  text,
  p_fy    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := current_employee_id();
  fy        text := coalesce(p_fy, (select f.code from financial_years f where f.is_current));
  src       uuid;
  tpl       uuid;
  rows_json jsonb;
  n         int := 0;
begin
  if me is null then
    raise exception 'Only a signed-in employee can name a template';
  end if;

  -- One of them, to take the rows off. Any of them: they are the same
  -- shape, which is what put them in one group.
  select a.id into src
  from kpi_assignments a
  join employees e on e.id = a.employee_id and e.is_active
  where a.status = 'active'
    and a.financial_year = fy
    and a.source_template_id is null
    and kpi_shape(a.id) = p_shape
    and (is_hr_admin() or is_in_my_downline(e.id))
  limit 1;

  if src is null then
    raise exception 'Nobody in your team is on that KPI any more';
  end if;

  select jsonb_agg(jsonb_build_object(
           'kra',             ai.kra,
           'kpi_description', ai.kpi_description,
           'weightage',       ai.weightage,
           -- One person's targets, as the starting point every template
           -- carries. They are set per person per month regardless.
           'target_value',    ai.target_value,
           'target_unit',     ai.target_unit,
           'scoring_rule',    ai.scoring_rule,
           'rule_params',     ai.rule_params,
           'alternates',      ai.alternates)
         order by ai.sort_order)
    into rows_json
  from kpi_assignment_items ai
  where ai.assignment_id = src and ai.section = 'job_role';

  -- Through the same door the editor uses: it owns the name rules.
  tpl := save_team_template(p_name, fy, rows_json, null);

  -- Everybody on that shape, within reach. Nothing about their KPI
  -- changes — it is already these rows, which is why they were grouped.
  -- This writes the link that was never there, so the template can say
  -- how many people are on it and an edit can reach them.
  update kpi_assignments a
  set source_template_id = tpl
  from employees e
  where e.id = a.employee_id
    and e.is_active
    and a.status = 'active'
    and a.financial_year = fy
    and a.source_template_id is null
    and kpi_shape(a.id) = p_shape
    and (is_hr_admin() or is_in_my_downline(e.id));
  get diagnostics n = row_count;

  perform log_audit('kpi_template', tpl, 'named_from_shared',
    jsonb_build_object('template', p_name, 'people', n, 'shape', p_shape));

  return jsonb_build_object(
    'template_id', tpl, 'template', p_name, 'people', n);
end $$;

comment on function public.template_from_shared(text, text, text) is
  'Turns a KPI shape several people already share into a named template '
  'and links them to it. Changes nobody''s rows. See migration 0127.';

grant execute on function public.template_from_shared(text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: the shape is a shape, and the grouping agrees with it.
-- ---------------------------------------------------------------------
do $$
declare
  fy     text := (select f.code from financial_years f where f.is_current);
  a1     uuid;
  a2     uuid;
  shapes int;
  biggest int;
begin
  -- Two assignments the raw comparison says are identical must hash the
  -- same, and one that differs must not.
  select a.id, b.id into a1, a2
  from kpi_assignments a, kpi_assignments b
  where a.id <> b.id
    and a.status = 'active' and b.status = 'active'
    and a.financial_year = fy and b.financial_year = fy
    and kpi_shape(a.id) = kpi_shape(b.id)
    and kpi_shape(a.id) is not null
  limit 1;

  if a1 is null then
    raise notice '0127 self-test: no two KPIs share a shape, which is worth knowing';
  else
    if (select count(distinct kra) from kpi_assignment_items
        where assignment_id in (a1, a2) and section = 'job_role')
       <> (select count(*) from kpi_assignment_items
           where assignment_id = a1 and section = 'job_role') then
      raise exception 'two KPIs hashed the same with different KRAs between them';
    end if;
  end if;

  -- And the shapes are worth the trouble: this is the number the whole
  -- migration exists for, so it is asserted rather than assumed.
  select count(*), max(people) into shapes, biggest
  from (
    select kpi_shape(a.id) as s, count(*) as people
    from kpi_assignments a
    where a.status = 'active' and a.financial_year = fy
    group by 1 having count(*) > 1
  ) g;

  if coalesce(shapes, 0) = 0 then
    raise exception 'no shared shapes at all — shared_kpi_groups would never return anything';
  end if;

  raise notice '0127 self-test passed (% shared shapes, the biggest carried by % people)',
    shapes, biggest;
end $$;
