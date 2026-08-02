-- =====================================================================
-- Cyrix KPI  ·  0022  ·  A month in progress is not yet due
--
-- The report counted every month up to and including the current one.
-- August's KPI is submitted during September, so on 2 August the report
-- was carrying a month nobody could possibly have done: 1,144 people
-- landing in "with team member" for work that is not late, and a
-- completion percentage divided by five months when only four were due.
--
-- `<` rather than `<=`. Same rule the submission screens already apply
-- through isMonthOpen — a month becomes assessable once it has ended.
-- =====================================================================
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
      -- Strictly before the current month: a month is due only once it
      -- has ended.
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
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  n_now   bigint;
  n_month bigint;
  people  bigint;
  months  integer;
begin
  -- The month in progress must contribute nothing.
  select coalesce(sum(team), 0) into n_month
  from kpi_report('2026-27', date_trunc('month', current_date)::date,
                  null, null, null, array['manager']);
  if n_month <> 0 then
    raise exception
      'the current month is still being reported: % rows', n_month;
  end if;

  -- Year to date must be exactly the finished months times the headcount.
  select count(*) into people
  from employees t join employees m on m.id = t.reporting_manager_id
  where t.is_active and m.is_active;

  select count(*) into months
  from generate_series(date '2026-04-01', date '2027-03-01', interval '1 month') g
  where g::date < date_trunc('month', current_date)::date;

  select coalesce(sum(team), 0) into n_now
  from kpi_report('2026-27', null, null, null, null, array['manager']);

  if n_now <> people * months then
    raise exception
      'year to date is % but % people over % finished month(s) is %',
      n_now, people, months, people * months;
  end if;

  raise notice '0022 self-test passed — % people over % finished month(s) = %',
    people, months, n_now;
end $$;
