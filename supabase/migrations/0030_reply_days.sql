-- =====================================================================
-- Cyrix KPI  ·  0030  ·  One clock, not two
--
-- The manager rank measures "did you score it within 7 days of it
-- reaching you". The figure shown beside it measured something else:
-- days from the 1st of the following month. Both are called turnaround,
-- both are in days, and they answer different questions — so a manager
-- reading "you get 7 days" next to "you averaged 2.7 days" was being
-- invited to compare two numbers that do not belong on the same line.
--
-- avg_reply_days is the same clock as the allowance: from the moment the
-- team member submits to the moment the manager scores it. Now the
-- allowance and the average can sit next to each other and mean
-- something together, and it breaks ties on the rank for the same
-- reason — a tie-break in a different unit from the thing being tied is
-- how a ranking becomes unexplainable.
--
-- avg_tat_days stays on the row, unchanged and unused by the profile.
-- It is the figure HR reads in the report, measured from the month
-- boundary, and the two are meant to differ: one asks how quickly the
-- manager replied, the other how late the month closed.
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
  mgr_rank        integer,
  mgr_of          integer,
  on_time_pct     numeric,
  /** From the month boundary — the same figure as RM TAT in the report. */
  avg_tat_days    numeric,
  /** From the team member submitting — the clock the allowance uses. */
  avg_reply_days  numeric,
  answerable      integer,
  on_time_count   integer,
  allowance_days  integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
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
  answerable_months as (
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
      end as tat_days,
      case when s.manager_scored_at is not null then
        greatest(0, extract(epoch from (
          s.manager_scored_at - s.self_submitted_at
        )) / 86400.0)
      end as reply_days
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
      round(avg(a.reply_days), 1)                                    as reply_days,
      count(*)::int                                                  as n_due,
      count(*) filter (where a.on_time)::int                         as n_on_time
    from answerable_months a
    group by a.mgr_id
  ),
  mgr_ranked as (
    select
      b.*,
      -- Most finished in time wins; the quicker reply breaks a tie. Same
      -- clock as the allowance, so the tie-break is in the unit the rank
      -- is actually about.
      rank()   over (order by b.pct desc, b.reply_days asc nulls last) as m_rank,
      count(*) over ()                                                 as m_of
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
    m.reply_days,
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
  'and within Cyrix on score, and — for managers — the share of their '
  'team''s submissions scored inside the allowance, ties broken by how '
  'quickly they replied. Positions and denominators only.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  r     record;
  fy    text;
  mgr   uuid;
begin
  select code into fy from financial_years where is_current;

  select mgr.id into mgr
  from kpi_submissions s
  join employees tm  on tm.id = s.employee_id and tm.is_active
  join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
  where s.financial_year = fy and s.manager_scored_at is not null
  limit 1;

  if mgr is null then
    raise notice '0030 self-test skipped — nobody has scored a month yet';
    return;
  end if;

  select * into r from kpi_ranking(mgr, fy);

  if r.avg_reply_days is null then
    raise exception 'a manager who has scored months has no reply time';
  end if;
  if r.avg_reply_days < 0 then
    raise exception 'reply time is negative: %', r.avg_reply_days;
  end if;

  -- The reply clock starts later than the month-boundary clock, so it
  -- can never be the longer of the two. If it is, the two have been
  -- swapped — which is the whole failure this migration exists to stop.
  if r.avg_tat_days is not null and r.avg_reply_days > r.avg_tat_days + 0.05 then
    raise exception
      'reply time % exceeds turnaround % — the clocks are the wrong way round',
      r.avg_reply_days, r.avg_tat_days;
  end if;

  -- Everything on time means nobody exceeded the allowance.
  if r.on_time_pct = 100 and r.avg_reply_days > r.allowance_days then
    raise exception
      '100%% on time but the average reply of % days is past the % day allowance',
      r.avg_reply_days, r.allowance_days;
  end if;

  raise notice
    '0030 self-test passed — reply % days sits inside turnaround % days, '
    'allowance % days', r.avg_reply_days, r.avg_tat_days, r.allowance_days;
end $$;
