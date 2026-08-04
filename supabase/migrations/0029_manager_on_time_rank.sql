-- =====================================================================
-- Cyrix KPI  ·  0029  ·  Rank managers on what they finished, not only
--                        on how fast they were when they bothered
--
-- 0028 ranked managers on average turnaround, and that average was taken
-- over the months they had actually scored. Months they never touched
-- were not in it. So a manager who scored one of sixteen people quickly
-- outranked one who scored all sixteen in four days: the metric paid for
-- doing less, as long as the little you did was fast.
--
-- The fix is one figure that carries both, with no invented weights:
--
--   of the person-months that reached me, how many did I turn around
--   within the time the company allows?
--
-- Not scoring counts against you. Scoring late counts against you. And
-- the allowance is not a number I chose — it is the gap between
-- closes_day and manager_closes_day in the submission_window setting,
-- which is to say the days between "the team member's deadline" and
-- "the manager's deadline". Seven, today.
--
-- Three things are deliberately NOT counted against a manager:
--
--   · months nobody submitted — they cannot score what has not arrived,
--     and "with team member" is already reported separately;
--   · months where the allowance has not run out yet, scored or not,
--     because a submission that landed yesterday is not late;
--   · a team member submitting late — the clock starts when the work
--     reaches the manager, not when the month ended, or the manager
--     wears somebody else's delay.
--
-- Average turnaround stays on the row as supporting detail, still
-- measured from the month boundary so it keeps matching the RM TAT in
-- HR's report, and it breaks ties on the rank.
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
  -- Managers only. Null for anyone with no reports, and for a manager
  -- with nothing yet due back from them.
  mgr_rank        integer,
  mgr_of          integer,
  on_time_pct     numeric,
  avg_tat_days    numeric,
  -- The two counts the percentage came from, so the screen can show its
  -- working rather than a figure nobody can check.
  answerable      integer,
  on_time_count   integer,
  allowance_days  integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
  -- The days a manager is allowed, from the team member's deadline to
  -- their own. Defaults match the seeded setting.
  allow  int;
begin
  if target is null then
    return;
  end if;

  if not (target = current_employee_id()
          or manages_employee(target)
          or is_hr_admin()) then
    raise exception 'You can only see your own ranking';
  end if;

  select greatest(1,
           coalesce((value->>'manager_closes_day')::int, 14)
           - coalesce((value->>'closes_day')::int, 7))
  into allow
  from app_settings where key = 'submission_window';
  allow := coalesce(allow, 7);

  return query
  with scored as (
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
      sc.emp,
      sc.avg_score,
      rank()  over (partition by sc.mgr order by sc.avg_score desc) as t_rank,
      count(*) over (partition by sc.mgr)                           as t_of,
      rank()  over (order by sc.avg_score desc)                     as o_rank,
      count(*) over ()                                              as o_of
    from scored sc
  ),
  -- Every person-month that has reached a manager and is now answerable
  -- for: either they scored it, or their allowance has run out.
  answerable as (
    select
      mgr.id as mgr_id,
      (s.manager_scored_at is not null
       and s.manager_scored_at
           <= s.self_submitted_at + make_interval(days => allow)) as on_time,
      case when s.manager_scored_at is not null then
        greatest(0, extract(epoch from (
          s.manager_scored_at
          - ((s.period_month + interval '1 month') at time zone 'Asia/Kolkata')
        )) / 86400.0)
      end as tat_days
    from kpi_submissions s
    join employees tm  on tm.id = s.employee_id and tm.is_active
    join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
    where s.financial_year = fy
      and s.self_submitted_at is not null
      and s.period_month < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
      and (s.manager_scored_at is not null
           or now() > s.self_submitted_at + make_interval(days => allow))
  ),
  by_manager as (
    select
      a.mgr_id,
      round(100.0 * count(*) filter (where a.on_time) / count(*), 1) as pct,
      round(avg(a.tat_days), 1)                                      as avg_days,
      count(*)::int                                                  as n_due,
      count(*) filter (where a.on_time)::int                         as n_on_time
    from answerable a
    group by a.mgr_id
  ),
  mgr_ranked as (
    select
      b.mgr_id,
      b.pct,
      b.avg_days,
      b.n_due,
      b.n_on_time,
      -- Most finished on time wins; the quicker of two equals breaks it.
      rank()   over (order by b.pct desc, b.avg_days asc nulls last) as m_rank,
      count(*) over ()                                               as m_of
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
    m.avg_days,
    m.n_due,
    m.n_on_time,
    case when m.mgr_id is null then null else allow end
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;

comment on function kpi_ranking(uuid, text) is
  'One person''s standing for a financial year: rank within their team '
  'and within Cyrix on score, and — for managers — rank among managers '
  'on the share of their team''s submissions turned around within the '
  'allowance, ties broken by turnaround. Positions and denominators '
  'only, never another employee''s figures.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy      text;
  r       record;
  best    uuid;
  n_mgrs  int;
  top_pct numeric;
  tm_only uuid;
begin
  select code into fy from financial_years where is_current;

  select count(*) into n_mgrs from (
    select mgr.id
    from kpi_submissions s
    join employees tm  on tm.id = s.employee_id and tm.is_active
    join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
    where s.financial_year = fy
      and s.self_submitted_at is not null
      and s.period_month < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
      and (s.manager_scored_at is not null
           or now() > s.self_submitted_at + interval '7 days')
    group by mgr.id
  ) x;

  if n_mgrs = 0 then
    raise notice '0029 self-test skipped — nothing is answerable yet';
    return;
  end if;

  select mgr_id into best from (
    select mgr.id as mgr_id,
      100.0 * count(*) filter (
        where s.manager_scored_at is not null
          and s.manager_scored_at <= s.self_submitted_at + interval '7 days'
      ) / count(*) as pct
    from kpi_submissions s
    join employees tm  on tm.id = s.employee_id and tm.is_active
    join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
    where s.financial_year = fy
      and s.self_submitted_at is not null
      and s.period_month < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
      and (s.manager_scored_at is not null
           or now() > s.self_submitted_at + interval '7 days')
    group by mgr.id
  ) y order by pct desc limit 1;

  select * into r from kpi_ranking(best, fy);

  if r.mgr_rank <> 1 then
    raise exception 'the best on-time manager came back at rank %', r.mgr_rank;
  end if;
  if r.mgr_of <> n_mgrs then
    raise exception 'ranked against % managers, expected %', r.mgr_of, n_mgrs;
  end if;
  if r.on_time_pct is null or r.on_time_pct < 0 or r.on_time_pct > 100 then
    raise exception 'on-time share is %', coalesce(r.on_time_pct::text, 'null');
  end if;

  top_pct := r.on_time_pct;

  -- Sorted the right way round. This ranks on a percentage where higher
  -- is better and breaks ties on days where lower is better, which is
  -- two directions in one window function and easy to get backwards.
  if exists (
    select 1 from (
      select mgr.id as mgr_id,
        100.0 * count(*) filter (
          where s.manager_scored_at is not null
            and s.manager_scored_at <= s.self_submitted_at + interval '7 days'
        ) / count(*) as pct
      from kpi_submissions s
      join employees tm  on tm.id = s.employee_id and tm.is_active
      join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
      where s.financial_year = fy
        and s.self_submitted_at is not null
        and s.period_month < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
        and (s.manager_scored_at is not null
             or now() > s.self_submitted_at + interval '7 days')
      group by mgr.id
    ) z where z.pct > top_pct
  ) then
    raise exception
      'rank 1 is on %%% on time but somebody finished more', top_pct;
  end if;

  -- Somebody with no reports is not a manager and is not ranked as one.
  select e.id into tm_only from employees e
  where e.is_active and e.reporting_manager_id is not null
    and e.id not in (select distinct reporting_manager_id from employees
                     where reporting_manager_id is not null)
  limit 1;

  if tm_only is not null then
    select * into r from kpi_ranking(tm_only, fy);
    if r.mgr_rank is not null or r.on_time_pct is not null then
      raise exception 'a team member with no reports was given a manager rank';
    end if;
  end if;

  raise notice
    '0029 self-test passed — best is 1 of % on %%% on time, nobody higher, '
    'non-managers unranked', n_mgrs, top_pct;
end $$;
