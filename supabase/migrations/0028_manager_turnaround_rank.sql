-- =====================================================================
-- Cyrix KPI  ·  0028  ·  Where a manager stands on turnaround
--
-- A manager's own KPI ranks them on their score like everybody else. It
-- says nothing about the part of the job only they have: their team
-- cannot close a month until the manager scores it, and a manager who
-- takes three weeks holds sixteen people up.
--
-- So: a third rank, for managers, on average turnaround. Fastest first —
-- 1.5 days beats 2.3 — which is the opposite direction to the other two
-- and the reason it is its own number rather than another score.
--
-- The clock is the one the reports already use: from the first of the
-- month AFTER the month being assessed, to the moment the manager
-- submits their scores. July's assessment starts its clock on 1 August,
-- because that is the first moment the work could have been done. So
-- "my average" here is the same figure as the RM TAT row against my name
-- in HR's report, and attributed the same way — to the team member's
-- current reporting manager — or the two would disagree and both would
-- be doubted.
--
-- Dropped and recreated rather than replaced: the return type gains
-- three columns, and CREATE OR REPLACE FUNCTION cannot change it.
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
  -- Null for anyone who is not a manager, and for a manager who has not
  -- scored a month yet. Not zero: no turnaround is not a fast one.
  tat_rank        integer,
  tat_of          integer,
  avg_tat_days    numeric
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
  -- One row per month a manager has actually turned around.
  turnarounds as (
    select
      mgr.id as mgr_id,
      greatest(0, extract(epoch from (
        s.manager_scored_at
        - ((s.period_month + interval '1 month') at time zone 'Asia/Kolkata')
      )) / 86400.0) as days
    from kpi_submissions s
    join employees tm  on tm.id = s.employee_id and tm.is_active
    join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
    where s.financial_year = fy
      and s.manager_scored_at is not null
  ),
  tat_ranked as (
    select
      t.mgr_id,
      round(avg(t.days), 1)                                  as avg_days,
      rank()   over (order by avg(t.days) asc)               as m_rank,
      count(*) over ()                                       as m_of
    from turnarounds t
    group by t.mgr_id
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
    tr.m_rank::int,
    tr.m_of::int,
    tr.avg_days
  from (select 1) one
  left join ranked   r  on r.emp = target
  left join tat_ranked tr on tr.mgr_id = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;

comment on function kpi_ranking(uuid, text) is
  'One person''s standing for a financial year: rank within their team '
  'and within Cyrix on score, and — for managers — rank among managers '
  'on turnaround, fastest first. Returns positions and denominators '
  'only, never another employee''s figures.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text;
  r        record;
  fastest  uuid;
  n_mgrs   int;
  tm_only  uuid;
begin
  select code into fy from financial_years where is_current;

  with turnarounds as (
    select mgr.id as mgr_id,
      greatest(0, extract(epoch from (
        s.manager_scored_at
        - ((s.period_month + interval '1 month') at time zone 'Asia/Kolkata')
      )) / 86400.0) as days
    from kpi_submissions s
    join employees tm  on tm.id = s.employee_id and tm.is_active
    join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
    where s.financial_year = fy and s.manager_scored_at is not null
  )
  select mgr_id, count(*) over () into fastest, n_mgrs
  from (select mgr_id, avg(days) d from turnarounds group by mgr_id) x
  order by d asc limit 1;

  if fastest is null then
    raise notice '0028 self-test skipped — no manager has scored a month yet';
    return;
  end if;

  select * into r from kpi_ranking(fastest, fy);

  if r.tat_rank <> 1 then
    raise exception 'the quickest manager came back at turnaround rank %', r.tat_rank;
  end if;
  if r.avg_tat_days is null or r.avg_tat_days < 0 then
    raise exception 'average turnaround is %', coalesce(r.avg_tat_days::text, 'null');
  end if;
  if r.tat_of <> n_mgrs then
    raise exception 'ranked against % managers, expected %', r.tat_of, n_mgrs;
  end if;

  -- Fastest must genuinely be the smallest number, not the largest: this
  -- rank sorts the opposite way to the other two and that is exactly the
  -- kind of thing a copy-paste gets backwards.
  if exists (
    with turnarounds as (
      select mgr.id as mgr_id,
        greatest(0, extract(epoch from (
          s.manager_scored_at
          - ((s.period_month + interval '1 month') at time zone 'Asia/Kolkata')
        )) / 86400.0) as days
      from kpi_submissions s
      join employees tm  on tm.id = s.employee_id and tm.is_active
      join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
      where s.financial_year = fy and s.manager_scored_at is not null
    )
    select 1 from (select mgr_id, avg(days) d from turnarounds group by mgr_id) x
    where x.d < r.avg_tat_days
  ) then
    raise exception
      'rank 1 has an average of % days but somebody is quicker', r.avg_tat_days;
  end if;

  -- Somebody with no reports has no turnaround to rank.
  select e.id into tm_only from employees e
  where e.is_active and e.reporting_manager_id is not null
    and e.id not in (select distinct reporting_manager_id from employees
                     where reporting_manager_id is not null)
  limit 1;

  if tm_only is not null then
    select * into r from kpi_ranking(tm_only, fy);
    if r.tat_rank is not null then
      raise exception 'a team member with no reports was ranked % on turnaround',
        r.tat_rank;
    end if;
  end if;

  raise notice
    '0028 self-test passed — quickest manager is 1 of %, nobody is quicker, '
    'and non-managers are unranked', n_mgrs;
end $$;
