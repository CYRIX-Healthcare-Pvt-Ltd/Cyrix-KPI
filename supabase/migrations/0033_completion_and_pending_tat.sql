-- =====================================================================
-- Cyrix KPI  ·  0033  ·  Two clocks, told apart
--
-- 0032 made the outstanding months age, which was right, and folded
-- them into one average, which was not. E1337 came out at 49.3 days —
-- a number that is true, means "the average owed month is 49 days old",
-- and reads like the manager takes seven weeks to score anything. Two
-- very different facts, blended into one figure that flatters neither:
--
--   she scores in       2.7 days
--   her backlog is     55.9 days old
--
-- So they separate:
--
--   Completion TAT  months that are scored — how long they took
--   Pending TAT     months that are not — how long they have waited,
--                   counted to today, whether the team member never
--                   submitted or the manager never scored
--
-- Neither hides the other. A manager who is quick but has a backlog now
-- shows exactly that, instead of one middling number that could mean
-- either.
--
-- Replaces tm_tat / rm_tat. That pair split the wait by WHO — team
-- member, then manager — which answers a question nobody was asking as
-- often as "is it done, and if not, how long has it been sitting?".
-- Both are still visible as counts, in the With manager and With team
-- member columns beside them.
-- =====================================================================

drop function if exists kpi_report(text, date, text, text, uuid, text[]);
drop view if exists v_kpi_report_rows;

create view v_kpi_report_rows
with (security_invoker = true) as
select
  fy.code                                   as financial_year,
  mo.period_month,
  tm.id                                     as employee_id,
  tm.ecode,
  tm.full_name,
  coalesce(nullif(trim(tm.function_name), ''), 'Unassigned')  as function_name,
  coalesce(nullif(trim(tm.department), ''), 'Unassigned')     as department,
  mgr.id                                    as manager_id,
  mgr.ecode                                 as manager_ecode,
  mgr.full_name                             as manager_name,
  sub.status,
  sub.final_total_score,

  exists (
    select 1 from kpi_assignments a
    where a.employee_id = tm.id
      and a.financial_year = fy.code
      and a.status = 'active'
  )                                         as has_kpi,

  -- Exactly one of these is ever set for a given month, which is what
  -- lets avg() do the right thing on both without a filter: a scored
  -- month contributes only to completion, an unscored one only to
  -- pending.
  case when sub.status in ('scored','finalized') and sub.manager_scored_at is not null then
    greatest(0, extract(epoch from (
      sub.manager_scored_at
      - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as completion_tat_days,
  case when sub.status is null or sub.status not in ('scored','finalized')
         or sub.manager_scored_at is null then
    greatest(0, extract(epoch from (
      now() - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as pending_tat_days
from financial_years fy
cross join lateral generate_series(
  fy.starts_on, fy.ends_on, interval '1 month') gs
cross join lateral (select gs::date as period_month) mo
join employees tm
  on tm.is_active and tm.reporting_manager_id is not null
join employees mgr
  on mgr.id = tm.reporting_manager_id and mgr.is_active
left join kpi_submissions sub
  on sub.employee_id = tm.id and sub.period_month = mo.period_month;

grant select on v_kpi_report_rows to authenticated;

comment on view v_kpi_report_rows is
  'One row per active team member per month of the financial year. A '
  'month carries either a completion TAT or a pending TAT, never both, '
  'so the two averages never contaminate each other.';


create function kpi_report(
  p_financial_year text,
  p_month          date    default null,
  p_function       text    default null,
  p_department     text    default null,
  p_manager_id     uuid    default null,
  p_group_by       text[]  default array['function','department','manager']
)
returns table (
  function_name   text,
  department      text,
  manager_id      uuid,
  manager_ecode   text,
  manager_name    text,
  team            bigint,
  scored          bigint,
  to_score        bigint,
  not_submitted   bigint,
  kpi_not_set     bigint,
  scored_pct      numeric,
  avg_score       numeric,
  completion_tat  numeric,
  pending_tat     numeric
)
language plpgsql stable security invoker set search_path = public as $$
declare
  allowed  text[] := array['function','department','manager'];
  dim      text;
  sel      text := '';
  grp      text := '';
begin
  if p_group_by is null or cardinality(p_group_by) = 0 then
    raise exception 'Choose at least one of function, department or manager';
  end if;

  foreach dim in array p_group_by loop
    if not (dim = any (allowed)) then
      raise exception 'Cannot group by %', dim;
    end if;
  end loop;

  sel := sel || case when 'function' = any (p_group_by)
                     then 'r.function_name' else 'null::text' end || ', ';
  sel := sel || case when 'department' = any (p_group_by)
                     then 'r.department' else 'null::text' end || ', ';
  sel := sel || case when 'manager' = any (p_group_by)
                     then 'r.manager_id, r.manager_ecode, r.manager_name'
                     else 'null::uuid, null::text, null::text' end;

  grp := (select string_agg(
            case g when 'function' then 'r.function_name'
                   when 'department' then 'r.department'
                   else 'r.manager_id, r.manager_ecode, r.manager_name' end, ', ')
          from unnest(p_group_by) g);

  return query execute format($q$
    select %s,
      count(*)                                                    as team,
      count(*) filter (where r.status in ('scored','finalized'))   as scored,
      count(*) filter (where r.status = 'submitted')               as to_score,
      count(*) filter (where r.has_kpi
                         and (r.status is null
                              or r.status in ('draft','returned'))) as not_submitted,
      count(*) filter (where not r.has_kpi
                         and (r.status is null
                              or r.status in ('draft','returned'))) as kpi_not_set,
      round(100.0 * count(*) filter (where r.status in ('scored','finalized'))
            / nullif(count(*), 0), 1)                              as scored_pct,
      round(avg(r.final_total_score) filter (
              where r.status in ('scored','finalized')), 2)        as avg_score,
      round(avg(r.completion_tat_days), 1)                         as completion_tat,
      round(avg(r.pending_tat_days), 1)                            as pending_tat
    from v_kpi_report_rows r
    where r.financial_year = $1
      and ($2::date is null or r.period_month = $2)
      and r.period_month < date_trunc('month', current_date)::date
      and ($3::text is null or r.function_name = $3)
      and ($4::text is null or r.department = $4)
      and ($5::uuid is null or r.manager_id = $5)
    group by %s
    order by %s
  $q$, sel, grp, grp)
  using p_financial_year, p_month, p_function, p_department, p_manager_id;
end $$;

grant execute on function kpi_report(text, date, text, text, uuid, text[])
  to authenticated;


-- ---------------------------------------------------------------------
-- The same two figures on a manager's own scorecard.
-- ---------------------------------------------------------------------
drop function if exists kpi_ranking(uuid, text);

create function kpi_ranking(
  p_employee_id    uuid default null,
  p_financial_year text default null
)
returns table (
  employee_id      uuid,
  financial_year   text,
  score            numeric,
  team_rank        integer,
  team_of          integer,
  org_rank         integer,
  org_of           integer,
  team_size        integer,
  mgr_rank         integer,
  mgr_of           integer,
  completion_pct   numeric,
  due_months       integer,
  scored_months    integer,
  completion_tat   numeric,
  pending_tat      numeric
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
  by_manager as (
    select
      r.manager_id                                                    as mgr_id,
      count(*)::int                                                   as n_due,
      count(*) filter (
        where r.status in ('scored','finalized'))::int                as n_done,
      round(100.0 * count(*) filter (
        where r.status in ('scored','finalized')) / count(*), 1)      as pct,
      round(avg(r.completion_tat_days), 1)                            as comp_tat,
      round(avg(r.pending_tat_days), 1)                               as pend_tat
    from v_kpi_report_rows r
    where r.financial_year = fy
      and r.period_month < date_trunc('month', current_date)::date
    group by r.manager_id
  ),
  mgr_ranked as (
    select
      b.*,
      -- Doing the work first. Then the age of what is left, because a
      -- rotting backlog is worse than a slow finish. Nulls first: no
      -- backlog at all is the best possible answer.
      rank() over (
        order by b.pct desc, b.pend_tat asc nulls first, b.comp_tat asc nulls first
      )                                                as m_rank,
      count(*) over ()                                 as m_of
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
    m.comp_tat,
    m.pend_tat
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;

comment on function kpi_ranking(uuid, text) is
  'One person''s standing for a financial year, plus — for managers — '
  'completion of every month their team owes, split into how long the '
  'finished ones took and how long the unfinished ones have waited.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy      text;
  mgr     uuid;
  rep     record;
  prof    record;
  n_both  bigint;
begin
  select code into fy from financial_years where is_current;

  -- No month may carry both clocks. If one ever did, both averages
  -- would be quietly wrong and nothing would say so.
  select count(*) into n_both
  from v_kpi_report_rows
  where financial_year = fy
    and completion_tat_days is not null
    and pending_tat_days is not null;
  if n_both <> 0 then
    raise exception '% month(s) are counted as both done and pending', n_both;
  end if;

  select mgr.id into mgr
  from employees tm
  join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
  join kpi_submissions s
    on s.employee_id = tm.id and s.status in ('scored','finalized')
  where tm.is_active and s.financial_year = fy
  group by mgr.id order by count(*) desc limit 1;

  if mgr is null then
    raise notice '0033 self-test skipped — nobody has scored a month yet';
    return;
  end if;

  select * into rep from kpi_report(fy, null, null, null, mgr, array['manager']);
  select * into prof from kpi_ranking(mgr, fy);

  -- The completed months must be quicker than the pending ones are old.
  -- Otherwise the two have been swapped, which is the failure this whole
  -- migration exists to prevent and which no error would reveal.
  if rep.completion_tat is not null and rep.pending_tat is not null
     and rep.completion_tat > rep.pending_tat then
    raise exception
      'completion TAT % exceeds pending TAT % — the clocks are swapped',
      rep.completion_tat, rep.pending_tat;
  end if;

  if rep.completion_tat is distinct from prof.completion_tat
     or rep.pending_tat is distinct from prof.pending_tat then
    raise exception
      'report says %/% and the profile says %/%',
      rep.completion_tat, rep.pending_tat,
      prof.completion_tat, prof.pending_tat;
  end if;
  if rep.scored_pct is distinct from prof.completion_pct then
    raise exception 'report says %%% complete, profile says %%%',
      rep.scored_pct, prof.completion_pct;
  end if;

  raise notice
    '0033 self-test passed — completion % days, pending % days, %%% done, '
    'report and profile agreeing', rep.completion_tat, rep.pending_tat,
    rep.scored_pct;
end $$;
