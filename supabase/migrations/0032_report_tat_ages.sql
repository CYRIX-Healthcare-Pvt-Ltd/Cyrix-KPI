-- =====================================================================
-- Cyrix KPI  ·  0032  ·  The report's TAT ages too
--
-- 0031 fixed the manager's own scorecard so that a month nobody has
-- scored keeps accruing days instead of dropping out of the average.
-- HR's report was left on the old rule, and the mismatch was not
-- academic: of 165 manager rows, 164 had NO RM TAT at all.
--
-- That is the wrong way round in the worst way. A manager who has
-- scored nothing all year produced a blank cell — no data, nothing to
-- chase — while the one manager actually doing the work showed 2.7
-- days and looked, if anything, worse. The column HR uses to find the
-- slow managers was structurally incapable of showing them.
--
-- The cause is quiet: rm_tat_days is NULL when manager_scored_at is
-- NULL, and avg() skips NULLs. Nothing errors. The number is simply
-- computed over the wrong rows, and it looks entirely reasonable.
--
-- Both clocks now run on the unfinished months, counted to now:
--
--   tm_tat  submitted → days the team member took
--           not sent  → days it has been waiting, so far
--   rm_tat  scored    → days the manager took
--           not done  → days it has been waiting, so far
--
-- Same definition as the profile tile, so a manager reading their own
-- average and HR reading the same manager's row see one number.
--
-- The figures move a lot, and they are meant to: this is the backlog
-- becoming visible, not the measurement getting worse.
-- =====================================================================

create or replace view v_kpi_report_rows
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

  -- Still running until it is done. coalesce(..., now()) is the whole
  -- change: without it the case falls through to NULL and avg() drops
  -- the row, which is how a hundred untouched months averaged to a
  -- blank cell.
  greatest(0, extract(epoch from (
    coalesce(sub.self_submitted_at, now())
    - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
  )) / 86400.0)                             as tm_tat_days,
  greatest(0, extract(epoch from (
    coalesce(
      case when sub.status in ('scored','finalized') then sub.manager_scored_at end,
      now())
    - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
  )) / 86400.0)                             as rm_tat_days
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
  'One row per active team member per month of the financial year. The '
  'two TAT columns count to now while the work is outstanding, so a '
  'month nobody has touched ages rather than disappearing from the '
  'average.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy        text;
  n_rows    bigint;
  n_null    bigint;
  n_blank   int;
  n_mgrs    int;
  mgr       uuid;
  rep_tat   numeric;
  prof_tat  numeric;
begin
  select code into fy from financial_years where is_current;

  -- Nothing may be null any more: every owed month has an age, even if
  -- that age is "nobody has started".
  select count(*), count(*) filter (where rm_tat_days is null or tm_tat_days is null)
  into n_rows, n_null
  from v_kpi_report_rows
  where financial_year = fy
    and period_month < date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;

  if n_rows = 0 then
    raise notice '0032 self-test skipped — no ended months yet';
    return;
  end if;
  if n_null <> 0 then
    raise exception '% of % owed months still have no TAT', n_null, n_rows;
  end if;

  -- The symptom that started this: manager rows with a blank RM TAT.
  select count(*), count(*) filter (where rm_tat is null)
  into n_mgrs, n_blank
  from kpi_report(fy, null, null, null, null, array['manager']);

  if n_blank <> 0 then
    raise exception
      '% of % manager rows still show no RM TAT', n_blank, n_mgrs;
  end if;

  -- And the report must now agree with the profile tile for the same
  -- manager, which is the reason this migration exists.
  select mgr.id into mgr
  from employees tm
  join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
  where tm.is_active
  group by mgr.id order by count(*) desc limit 1;

  select rm_tat into rep_tat
  from kpi_report(fy, null, null, null, mgr, array['manager']);
  select avg_age_days into prof_tat from kpi_ranking(mgr, fy);

  if rep_tat is null or prof_tat is null then
    raise exception 'one side has no figure: report %, profile %', rep_tat, prof_tat;
  end if;
  if abs(rep_tat - prof_tat) > 0.11 then
    raise exception
      'the report says % days and the profile says %', rep_tat, prof_tat;
  end if;

  raise notice
    '0032 self-test passed — % owed months all aged, % manager rows all '
    'carry an RM TAT, and report % = profile %',
    n_rows, n_mgrs, rep_tat, prof_tat;
end $$;
