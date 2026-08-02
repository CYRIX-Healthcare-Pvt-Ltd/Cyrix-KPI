-- =====================================================================
-- Cyrix KPI  ·  0021  ·  Turnaround measured in elapsed time, and
--                        "no KPI" separated from "not submitted"
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Turnaround now counts the clock, and the +1 goes with it.
--
-- The +1 existed to stop a same-day submission reading as zero: submit
-- on the 1st, score 1. Once the time of day is counted that problem
-- solves itself — a submission at 12:17 on the 1st is 0.5 days, which is
-- both non-zero and true — and keeping the +1 would inflate every figure
-- by a day.
--
-- Same window, same origin: midnight IST on the 1st of the month after
-- the KPI month. Only the resolution changes, from whole days to
-- fractions of one.
--
-- Clamped at zero. A month cannot be assessed until it has finished, so
-- this should never be negative; that gate is enforced in the client
-- rather than here, and a negative turnaround would read as a bug rather
-- than as the early submission it actually was.
-- ---------------------------------------------------------------------
-- Dropped rather than replaced: turnaround changes from integer to
-- numeric, and CREATE OR REPLACE cannot change a column's type or insert
-- one before the end. Nothing in the database depends on this view —
-- kpi_report builds its query as text — so the drop is local to it.
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

  -- Does this person have an agreed KPI for the year at all? Without one
  -- they cannot submit anything, which is a different problem from
  -- having one and not using it.
  exists (
    select 1 from kpi_assignments a
    where a.employee_id = tm.id
      and a.financial_year = fy.code
      and a.status = 'active'
  )                                         as has_kpi,

  case when sub.self_submitted_at is not null then
    greatest(0, extract(epoch from (
      sub.self_submitted_at
      - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as tm_tat_days,
  case when sub.manager_scored_at is not null then
    greatest(0, extract(epoch from (
      sub.manager_scored_at
      - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as rm_tat_days
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


-- ---------------------------------------------------------------------
-- 2. "Not in" was two different problems wearing one number.
--
-- It counted everyone with nothing submitted for the month, which today
-- is almost entirely people who have no KPI at all — 1,145 of 1,148.
-- Those two need opposite responses: one is a setup job, the other is a
-- reminder. Reporting them together tells HR to chase 1,145 people for a
-- submission they are not able to make.
--
-- The four buckets are disjoint by construction and must add up to team;
-- the self-test enforces it.
-- ---------------------------------------------------------------------
-- Dropped for the same reason as the view: the result gains a column, and
-- a function's return type cannot be altered in place.
drop function if exists kpi_report(text, date, text, text, uuid, text[]);

create function kpi_report(
  p_financial_year text,
  p_month          date    default null,
  p_function       text    default null,
  p_department     text    default null,
  p_manager_id     uuid    default null,
  p_group_by       text[]  default array['function','department','manager']
)
returns table (
  function_name  text,
  department     text,
  manager_id     uuid,
  manager_ecode  text,
  manager_name   text,
  team           bigint,
  scored         bigint,
  to_score       bigint,
  not_submitted  bigint,
  kpi_not_set    bigint,
  scored_pct     numeric,
  avg_score      numeric,
  tm_tat         numeric,
  rm_tat         numeric
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
      round(avg(r.tm_tat_days), 1)                                 as tm_tat,
      round(avg(r.rm_tat_days), 1)                                 as rm_tat
    from v_kpi_report_rows r
    where r.financial_year = $1
      and ($2::date is null or r.period_month = $2)
      and r.period_month <= date_trunc('month', current_date)::date
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
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  bad     text;
  n_whole integer;
  n_any   integer;
begin
  -- The four buckets must account for everybody exactly once.
  select string_agg(coalesce(manager_ecode, function_name, department), ', ')
  into bad
  from kpi_report('2026-27', null, null, null, null, array['manager'])
  where team <> scored + to_score + not_submitted + kpi_not_set;
  if bad is not null then
    raise exception 'buckets do not add up to team for %', bad;
  end if;

  -- Regrouping must not change the population.
  if (select sum(team) from kpi_report('2026-27', null, null, null, null, array['manager']))
     is distinct from
     (select sum(team) from kpi_report('2026-27', null, null, null, null,
                                       array['function','department','manager']))
  then
    raise exception 'regrouping changed the population';
  end if;

  -- Turnaround must now carry a fraction rather than landing on whole
  -- days, or the +1 was removed without the clock being counted.
  select count(*) filter (where tm_tat_days = trunc(tm_tat_days)),
         count(*)
  into n_whole, n_any
  from v_kpi_report_rows where tm_tat_days is not null;

  if n_any > 0 and n_whole = n_any then
    raise exception
      'every turnaround is still a whole number across % submission(s) — '
      'the clock is not being counted', n_any;
  end if;

  raise notice '0021 self-test passed — % submission(s), % on an exact day',
    n_any, n_whole;
end $$;
