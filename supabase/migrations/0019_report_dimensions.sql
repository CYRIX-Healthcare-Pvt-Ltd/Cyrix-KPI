-- =====================================================================
-- Cyrix KPI  ·  0019  ·  Function and grade, and one report to replace
--                        the three that were split by accident
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The dimensions HR actually reports on.
--
-- department has been null for all 1,148 rows since the first import —
-- the original file did not carry it, so every "by department" question
-- had nothing to group on. The new master carries Function and Grade
-- too. Function is the business unit (RJBEMP, APBEMP, Care 360…),
-- Department the broader category (SERVICE, Sales, Procurement…).
--
-- "function" is reserved in SQL, so the column is function_name.
-- ---------------------------------------------------------------------
alter table employees
  add column if not exists function_name text,
  add column if not exists grade         text;

comment on column employees.function_name is
  'Business unit from the HR master — RJBEMP, APBEMP, Care 360 and so on. '
  'Named function_name because "function" is a reserved word.';

create index if not exists idx_employees_function on employees(function_name);
create index if not exists idx_employees_department on employees(department);


-- ---------------------------------------------------------------------
-- 2. One row per employee per month, with everything the report needs.
--
-- The finest grain the report is ever asked about, so every grouping is
-- a sum over this rather than a separate query. security_invoker, so a
-- manager sees their own team and HR sees everyone.
--
-- Turnaround follows the definition in the spec: days from the 1st of
-- the month AFTER the KPI month, inclusive of the submission day. July's
-- KPI submitted on 5 August is 5 August − 1 August + 1 = 5. Submitting
-- in September keeps counting, which is the point — a late month should
-- look late, not wrap around.
--
-- Dates are resolved in Asia/Kolkata. The timestamps are timestamptz, so
-- without this a submission at 9pm IST would count as the previous day.
-- ---------------------------------------------------------------------
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
  case when sub.self_submitted_at is not null then
    ((sub.self_submitted_at at time zone 'Asia/Kolkata')::date
      - (mo.period_month + interval '1 month')::date) + 1
  end                                       as tm_tat_days,
  case when sub.manager_scored_at is not null then
    ((sub.manager_scored_at at time zone 'Asia/Kolkata')::date
      - (mo.period_month + interval '1 month')::date) + 1
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
-- 3. The report itself.
--
-- Three screens — completion by month, completion by manager, and
-- turnaround — were three answers to one question that happened to be
-- built on different days. This is the one query behind all of them.
--
-- p_group_by decides which columns survive: ask for {function} and the
-- result is one row per function; ask for {function,department,manager}
-- and it is the full breakdown. The grouping is built into SQL text, so
-- the names are whitelisted rather than interpolated on trust.
--
-- p_month null means the whole year so far, which is the "till date"
-- reading. Months that have not started yet are excluded either way, or
-- every total would be diluted by ten empty months.
-- ---------------------------------------------------------------------
create or replace function kpi_report(
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

  -- Columns not grouped on come back null, so the caller can drop them
  -- without having to know which shape it asked for.
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
      count(*)                                                   as team,
      count(*) filter (where r.status in ('scored','finalized'))  as scored,
      count(*) filter (where r.status = 'submitted')              as to_score,
      count(*) filter (where r.status is null
                          or r.status in ('draft','returned'))    as not_submitted,
      round(100.0 * count(*) filter (where r.status in ('scored','finalized'))
            / nullif(count(*), 0), 1)                             as scored_pct,
      round(avg(r.final_total_score) filter (
              where r.status in ('scored','finalized')), 2)       as avg_score,
      round(avg(r.tm_tat_days), 1)                                as tm_tat,
      round(avg(r.rm_tat_days), 1)                                as rm_tat
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
  n_all   bigint;
  n_group bigint;
  bad     text;
begin
  -- Grouping must not change the population, only how it is sliced.
  select sum(team) into n_all
  from kpi_report('2026-27', null, null, null, null, array['manager']);

  select sum(team) into n_group
  from kpi_report('2026-27', null, null, null, null,
                  array['function','department','manager']);

  if n_all is distinct from n_group then
    raise exception 'Regrouping changed the population: % vs %', n_all, n_group;
  end if;

  -- The buckets must account for everybody exactly once.
  select string_agg(manager_ecode, ', ') into bad
  from kpi_report('2026-27', null, null, null, null, array['manager'])
  where team <> scored + to_score + not_submitted;
  if bad is not null then
    raise exception 'team <> scored + to_score + not_submitted for %', bad;
  end if;

  -- Whitelist holds.
  begin
    perform kpi_report('2026-27', null, null, null, null, array['grade']);
    raise exception 'kpi_report accepted an ungrouped dimension';
  exception when others then
    if sqlerrm not like 'Cannot group by%' then raise; end if;
  end;

  raise notice '0019 self-test passed — % employee-months in scope', n_all;
end $$;
