-- =====================================================================
-- Cyrix KPI  ·  0042  ·  How you compare, without saying who
--
-- A manager can see that somebody is behind their peers on one KRA,
-- because a manager can read their team's scores. The person themselves
-- cannot, and that is RLS working correctly — no team member should be
-- able to read a colleague's numbers.
--
-- But "you are 19 points behind" is the most actionable thing this
-- system knows about somebody, and withholding it from the only person
-- who can act on it is the wrong trade. So the same gated-door pattern
-- as kpi_ranking: a definer function that reads everybody and returns
-- an average and a count, never a name, never a score belonging to one
-- person.
--
-- Two floors make that safe rather than nominally safe:
--
--   TWO OTHERS at least. An average of one is that person's score with
--   a word in front of it, and anybody who knows who else does their
--   job can read it straight back off the screen.
--
--   SAME KPI. The cohort is people whose whole set of KRAs matches —
--   from the agreed assignment, not from which months happen to have
--   been scored, because a colleague scored on fewer months would
--   otherwise drop out of the group and change the answer.
-- =====================================================================

create or replace function my_kra_benchmark(
  p_employee_id    uuid default null,
  p_financial_year text default null
)
returns table (
  kra       text,
  section   text,
  my_avg    numeric,
  peer_avg  numeric,
  /** People, not readings. Four people over three months is four. */
  peers     integer,
  my_months integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
  my_fp  text;
begin
  if target is null then return; end if;

  -- Same rule as every other cross-person read here: yourself, your
  -- team, or HR. Nobody browses a stranger's benchmark.
  if not (target = current_employee_id()
          or manages_employee(target)
          or is_hr_admin()) then
    raise exception 'You can only see your own benchmark';
  end if;

  select string_agg(distinct i.kra, ' | ' order by i.kra) into my_fp
  from kpi_assignments a
  join kpi_assignment_items i on i.assignment_id = a.id
  where a.employee_id = target
    and a.financial_year = fy
    and a.status = 'active';

  if my_fp is null then return; end if;

  return query
  with fp as (
    select a.employee_id,
           string_agg(distinct i.kra, ' | ' order by i.kra) as sig
    from kpi_assignments a
    join kpi_assignment_items i on i.assignment_id = a.id
    join employees e on e.id = a.employee_id and e.is_active
    where a.financial_year = fy and a.status = 'active'
    group by a.employee_id
  ),
  cohort as (
    select employee_id from fp where sig = my_fp
  ),
  readings as (
    select k.employee_id, k.kra, k.section, k.attainment_pct
    from v_kra_attainment k
    join cohort c on c.employee_id = k.employee_id
    where k.financial_year = fy
      and k.status in ('scored', 'finalized')
      and k.attainment_pct is not null
  )
  select
    r.kra,
    r.section::text,
    round(avg(r.attainment_pct) filter (where r.employee_id = target), 1),
    round(avg(r.attainment_pct) filter (where r.employee_id <> target), 1),
    count(distinct r.employee_id) filter (where r.employee_id <> target)::int,
    count(*) filter (where r.employee_id = target)::int
  from readings r
  group by r.kra, r.section
  having count(*) filter (where r.employee_id = target) > 0
     -- The floor, enforced here rather than in the app: a client
     -- calling this directly has to meet it too.
     and count(distinct r.employee_id) filter (where r.employee_id <> target) >= 2;
end $$;

grant execute on function my_kra_benchmark(uuid, text) to authenticated;

comment on function my_kra_benchmark(uuid, text) is
  'Your average on each KRA against everyone with the same KPI. Returns '
  'an average and a count of people, never a name and never one '
  'person''s score — and nothing at all below three people.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy   text;
  emp  uuid;
  n    int;
  bad  int;
begin
  select code into fy from financial_years where is_current;

  select a.employee_id into emp
  from kpi_assignments a
  join kpi_submissions s
    on s.employee_id = a.employee_id and s.status in ('scored','finalized')
  where a.financial_year = fy and a.status = 'active'
  group by a.employee_id order by count(*) desc limit 1;

  if emp is null then
    raise notice '0042 self-test skipped — nothing scored yet';
    return;
  end if;

  select count(*) into n from my_kra_benchmark(emp, fy);

  -- Nothing may come back that could name one person.
  select count(*) into bad from my_kra_benchmark(emp, fy) where peers < 2;
  if bad <> 0 then
    raise exception
      '% row(s) would expose a group too small to be an average', bad;
  end if;

  -- And nothing without a reading of their own to compare.
  select count(*) into bad from my_kra_benchmark(emp, fy) where my_months < 1;
  if bad <> 0 then
    raise exception '% row(s) compare somebody who has no score', bad;
  end if;

  raise notice
    '0042 self-test passed — % comparable KRA(s), none from a group '
    'smaller than three', n;
end $$;
