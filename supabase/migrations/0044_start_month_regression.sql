-- =====================================================================
-- Cyrix KPI  ·  0044  ·  Proving 0043 on data it brings with it
--
-- 0043's self-test looked for an active KPI with no assessments against
-- it, and there may not be one — in which case it printed a notice and
-- checked nothing. The interesting half of that migration is the view
-- filter, and "probably fine" is not a state a report should be left in.
--
-- So this builds its own subject: one employee, one draft KPI, counted
-- before and after a start month is put on it. Everything is removed
-- again before the file ends, and the file is one transaction, so a
-- failure anywhere leaves nothing behind either way.
--
-- No schema changes. It is a test, and it stays in the history as one —
-- if a later migration breaks the filter, the next person to rebuild
-- this database finds out here.
-- =====================================================================

do $$
declare
  fy        text;
  fy_start  date;
  mgr       uuid;
  emp       uuid;
  aid       uuid;
  target    date;
  rows_all  int;
  rows_cut  int;
  rows_back int;
  team_all  int;
  team_cut  int;
begin
  select code, starts_on into fy, fy_start from financial_years where is_current;

  -- Anybody active who manages nobody in particular will do; the row is
  -- deleted before this block ends.
  select id into mgr from employees where is_active limit 1;
  if mgr is null then
    raise exception '0044 cannot run — there are no active employees';
  end if;

  insert into employees (ecode, full_name, reporting_manager_id, is_active)
  values ('ZZ-0044-PROBE', '0044 start month probe', mgr, true)
  returning id into emp;

  -- Twelve months, because nothing has said otherwise yet.
  select count(*) into rows_all
  from v_kpi_report_rows where employee_id = emp and financial_year = fy;

  if rows_all <> 12 then
    raise exception
      'expected 12 report months for a person with no KPI, got %', rows_all;
  end if;

  select count(*) into team_all
  from v_manager_month_status
  where manager_id = mgr and financial_year = fy and period_month = fy_start;

  -- A KPI that starts three months in. Draft on purpose: the filter reads
  -- whichever KPI is live, not only approved ones, or somebody halfway
  -- through setting theirs up would be chased for months they had
  -- already accounted for.
  insert into kpi_assignments (employee_id, financial_year, status)
  values (emp, fy, 'draft') returning id into aid;

  target := (fy_start + interval '3 months')::date;
  update kpi_assignments set starts_from = target where id = aid;

  select count(*) into rows_cut
  from v_kpi_report_rows where employee_id = emp and financial_year = fy;

  if rows_cut <> 9 then
    raise exception
      'a KPI starting three months in should leave 9 report months, got %',
      rows_cut;
  end if;

  if exists (
    select 1 from v_kpi_report_rows
    where employee_id = emp and financial_year = fy and period_month < target)
  then
    raise exception 'months before the start are still in the report';
  end if;

  -- And the manager's grid stops counting them in the months before it.
  select count(*) into team_cut
  from v_manager_month_status
  where manager_id = mgr and financial_year = fy and period_month = fy_start;

  if team_all = 0 or team_cut <> team_all - 1 then
    raise exception
      'manager month grid counted % in the first month before and % after '
      '— expected one fewer', team_all, team_cut;
  end if;

  -- Removing the KPI puts every month back: the filter is reading the
  -- assignment each time, not something cached on the person.
  delete from kpi_assignments where id = aid;

  select count(*) into rows_back
  from v_kpi_report_rows where employee_id = emp and financial_year = fy;

  if rows_back <> 12 then
    raise exception
      'removing the KPI should restore 12 months, got %', rows_back;
  end if;

  delete from employees where id = emp;

  if exists (select 1 from employees where ecode = 'ZZ-0044-PROBE') then
    raise exception '0044 left its probe employee behind';
  end if;

  raise notice
    '0044 self-test passed — 12 months became % with a start three months '
    'in, and % again once the KPI was removed', rows_cut, rows_back;
end $$;
