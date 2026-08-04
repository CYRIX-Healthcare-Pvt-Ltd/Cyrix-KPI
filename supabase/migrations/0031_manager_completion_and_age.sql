-- =====================================================================
-- Cyrix KPI  ·  0031  ·  Count what is owed, not only what arrived
--
-- Two attempts at this have now had the same flaw in different places.
-- 0028 averaged turnaround over the months a manager had scored, so
-- ignoring fifteen people and scoring one quickly won. 0029 fixed the
-- ignoring but measured "on time" against the submissions that reached
-- the manager — so a manager with sixteen reports and eight submissions
-- sat at 100% while fifty-six person-months were outstanding.
--
-- Both were protecting the manager from the team's lateness. That is the
-- wrong instinct: getting the team to submit at all is the manager's
-- job, and a scorecard that quietly excuses the missing work measures
-- nothing worth measuring.
--
-- So the denominator is everything owed:
--
--     every active team member  ×  every month of the year that has ended
--
-- which is the same population as HR's report, so a manager's completion
-- here is the scored_pct on their row there. If the two disagreed, both
-- would be doubted.
--
-- And the clock runs on the months nobody has done. A scored month is
-- worth the days the manager took; an unscored one is worth the days it
-- has been sitting there, counted to right now. Left alone it keeps
-- getting worse, which is what an outstanding month actually does.
-- Excluding it, as every version until this one did, made a backlog
-- invisible in the one number meant to reveal it.
--
-- Ranked on completion first, then on that average — doing the work
-- matters more than doing it quickly, and speed only separates managers
-- who have both done it.
-- =====================================================================

drop function if exists kpi_ranking(uuid, text);

create function kpi_ranking(
  p_employee_id    uuid default null,
  p_financial_year text default null
)
returns table (
  employee_id     uuid,
  financial_year  text,
  score           numeric,
  team_rank       integer,
  team_of         integer,
  org_rank        integer,
  org_of          integer,
  team_size       integer,
  -- Managers only.
  mgr_rank        integer,
  mgr_of          integer,
  completion_pct  numeric,
  due_months      integer,
  scored_months   integer,
  /** Days per owed month: taken, or still running for the undone ones. */
  avg_age_days    numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
begin
  if target is null then
    return;
  end if;

  if not (target = current_employee_id()
          or manages_employee(target)
          or is_hr_admin()) then
    raise exception 'You can only see your own ranking';
  end if;

  return query
  with scored_people as (
    select
      s.employee_id                       as emp,
      e.reporting_manager_id              as mgr,
      round(avg(s.final_total_score), 4)  as avg_score
    from kpi_submissions s
    join employees e on e.id = s.employee_id and e.is_active
    where s.financial_year = fy
      and s.status in ('scored', 'finalized')
      and s.final_total_score is not null
    group by s.employee_id, e.reporting_manager_id
  ),
  ranked as (
    select
      sp.emp,
      sp.avg_score,
      rank()  over (partition by sp.mgr order by sp.avg_score desc) as t_rank,
      count(*) over (partition by sp.mgr)                           as t_of,
      rank()  over (order by sp.avg_score desc)                     as o_rank,
      count(*) over ()                                              as o_of
    from scored_people sp
  ),
  -- Everything owed: the team crossed with the months that have ended.
  -- A person with no KPI is still in here, because approving their KPI
  -- is the manager's job too — the same reason HR's report counts them.
  owed as (
    select
      mgr.id       as mgr_id,
      tm.id        as tm_id,
      g::date      as period_month
    from financial_years f
    cross join lateral generate_series(f.starts_on, f.ends_on, interval '1 month') g
    join employees tm  on tm.is_active and tm.reporting_manager_id is not null
    join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
    where f.code = fy
      and g::date < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
  ),
  aged as (
    select
      o.mgr_id,
      (s.status in ('scored', 'finalized') and s.manager_scored_at is not null)
        as done,
      greatest(0, extract(epoch from (
        coalesce(
          case when s.status in ('scored','finalized') then s.manager_scored_at end,
          now())
        - ((o.period_month + interval '1 month') at time zone 'Asia/Kolkata')
      )) / 86400.0) as age_days
    from owed o
    left join kpi_submissions s
      on s.employee_id = o.tm_id and s.period_month = o.period_month
  ),
  by_manager as (
    select
      a.mgr_id,
      count(*)::int                                                  as n_due,
      count(*) filter (where a.done)::int                            as n_done,
      round(100.0 * count(*) filter (where a.done) / count(*), 1)    as pct,
      round(avg(a.age_days), 1)                                      as avg_age
    from aged a
    group by a.mgr_id
  ),
  mgr_ranked as (
    select
      b.*,
      -- Doing the work first, speed second. A manager who has finished
      -- everything slowly is ahead of one who has finished a third of it
      -- in a day.
      rank()   over (order by b.pct desc, b.avg_age asc) as m_rank,
      count(*) over ()                                   as m_of
    from by_manager b
  )
  select
    target,
    fy,
    round(r.avg_score, 2),
    r.t_rank::int,
    r.t_of::int,
    r.o_rank::int,
    r.o_of::int,
    (select count(*)::int
     from employees p
     where p.is_active
       and p.reporting_manager_id =
           (select reporting_manager_id from employees where id = target)),
    m.m_rank::int,
    m.m_of::int,
    m.pct,
    m.n_due,
    m.n_done,
    m.avg_age
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;

comment on function kpi_ranking(uuid, text) is
  'One person''s standing for a financial year: rank within their team '
  'and within Cyrix on score, and — for managers — completion of every '
  'month owed by their team, ties broken by the average age of those '
  'months. Positions and denominators only.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text;
  r        record;
  mgr      uuid;
  team     int;
  months   int;
  rep_pct  numeric;
begin
  select code into fy from financial_years where is_current;

  select mgr.id into mgr
  from employees tm
  join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
  where tm.is_active
  group by mgr.id
  order by count(*) desc
  limit 1;

  if mgr is null then
    raise notice '0031 self-test skipped — nobody has reports';
    return;
  end if;

  select * into r from kpi_ranking(mgr, fy);

  select count(*) into team from employees
  where is_active and reporting_manager_id = mgr;

  select count(*) into months
  from financial_years f
  cross join lateral generate_series(f.starts_on, f.ends_on, interval '1 month') g
  where f.code = fy
    and g::date < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;

  -- The denominator is the whole team, not the part of it that submitted.
  -- This is the assertion the last two versions would have failed.
  if r.due_months <> team * months then
    raise exception
      'owed % months but % people over % ended months is %',
      r.due_months, team, months, team * months;
  end if;

  if r.scored_months > r.due_months then
    raise exception 'scored % of % owed', r.scored_months, r.due_months;
  end if;
  if r.completion_pct < 0 or r.completion_pct > 100 then
    raise exception 'completion is %%%', r.completion_pct;
  end if;

  -- An undone month is aging, so a manager with anything outstanding
  -- cannot show an average of zero.
  if r.scored_months < r.due_months and r.avg_age_days <= 0 then
    raise exception
      '% month(s) outstanding but the average age is % days',
      r.due_months - r.scored_months, r.avg_age_days;
  end if;

  -- And it must agree with the report HR reads.
  select scored_pct into rep_pct
  from kpi_report(fy, null, null, null, mgr, array['manager']);

  if rep_pct is not null and abs(rep_pct - r.completion_pct) > 0.11 then
    raise exception
      'profile says %%% complete, the report says %%%',
      r.completion_pct, rep_pct;
  end if;

  raise notice
    '0031 self-test passed — % of % months done (%%%), average age % days, '
    'matching the report', r.scored_months, r.due_months, r.completion_pct,
    r.avg_age_days;
end $$;
