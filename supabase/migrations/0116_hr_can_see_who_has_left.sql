-- =====================================================================
-- Cyrix KPI  ·  0116  ·  HR can see who has left
--
-- HR's Employees page reads v_org_kpi_status, which ends WHERE e.is_active,
-- so an inactive employee never reached the page at all. E7777 -- a test
-- account switched off by the 7 Sep payroll master upload -- was visible
-- in SW Admin, which reads login_status, and simply absent from HR, with
-- nothing to say why. Of the 55 inactive employees, 51 went that day.
--
-- The page gains an "Include inactive" option. It needs the rows.
--
-- The filter cannot just come off v_org_kpi_status: the HR Overview and
-- Reports pages read it too, and so does v_manager_completion, and all of
-- them count active people. So the query moves, unchanged, into
-- v_org_kpi_status_all -- without the filter, with is_active on the end --
-- and v_org_kpi_status becomes that view filtered to active. Same columns
-- in the same order, same rows, and one copy of the query rather than two
-- that could drift apart.
--
-- Both views are security_invoker, as the original was, so row-level
-- security on employees still decides what each caller sees: HR and SW
-- admins read everybody, a manager their own line.
--
-- The body below is the live definition read back with pg_get_viewdef,
-- with the filter removed and the column added. Nothing was retyped.
-- =====================================================================

create or replace view v_org_kpi_status_all with (security_invoker = true) as
SELECT e.id AS employee_id,
    e.ecode,
    e.full_name,
    e.designation,
    e.department,
    e.location,
    e.reporting_manager_id,
    m.ecode AS manager_ecode,
    m.full_name AS manager_name,
    a.financial_year,
    COALESCE(a.status, 'not_set_up'::text) AS kpi_status,
    a.approved_at,
    ( SELECT count(*) AS count
           FROM kpi_submissions s
          WHERE s.employee_id = e.id AND s.financial_year = a.financial_year AND (s.status = ANY (ARRAY['scored'::text, 'finalized'::text]))) AS months_scored,
    ( SELECT count(*) AS count
           FROM kpi_submissions s
          WHERE s.employee_id = e.id AND s.status = 'submitted'::text) AS months_awaiting_manager,
    ( SELECT round(avg(s.final_total_score), 2) AS round
           FROM kpi_submissions s
          WHERE s.employee_id = e.id AND s.financial_year = a.financial_year AND (s.status = ANY (ARRAY['scored'::text, 'finalized'::text]))) AS avg_score,
    -- The one column this view adds, and the reason it exists: which rows
    -- are people who have left. Appended so every column before it keeps
    -- its place.
    e.is_active
   FROM employees e
     LEFT JOIN employees m ON m.id = e.reporting_manager_id
     LEFT JOIN kpi_assignments a ON a.employee_id = e.id AND (a.status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'active'::text, 'rejected'::text]));

comment on view v_org_kpi_status_all is
  'v_org_kpi_status for every employee, active or not, with is_active. '
  'HR Employees reads this for its Include inactive option.';

grant select on v_org_kpi_status_all to authenticated;

create or replace view v_org_kpi_status with (security_invoker = true) as
select employee_id, ecode, full_name, designation, department, location, reporting_manager_id, manager_ecode, manager_name, financial_year, kpi_status, approved_at, months_scored, months_awaiting_manager, avg_score
from v_org_kpi_status_all
where is_active;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  cols_now      text[];
  cols_expected text[] := array['employee_id', 'ecode', 'full_name', 'designation', 'department', 'location', 'reporting_manager_id', 'manager_ecode', 'manager_name', 'financial_year', 'kpi_status', 'approved_at', 'months_scored', 'months_awaiting_manager', 'avg_score'];
  last_col      text;
  n_view        bigint;
  n_all_active  bigint;
  n_all         bigint;
  n_employees   bigint;
begin
  -- Every existing reader still gets exactly the columns it had.
  select array_agg(column_name::text order by ordinal_position) into cols_now
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_org_kpi_status';
  if cols_now is distinct from cols_expected then
    raise exception 'v_org_kpi_status columns changed: %', cols_now;
  end if;

  select column_name into last_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_org_kpi_status_all'
  order by ordinal_position desc limit 1;
  if last_col is distinct from 'is_active' then
    raise exception 'is_active should end v_org_kpi_status_all, found %', last_col;
  end if;

  -- Same rows as before: the active subset of the new view.
  select count(*) into n_view from v_org_kpi_status;
  select count(*) into n_all_active from v_org_kpi_status_all where is_active;
  if n_view <> n_all_active then
    raise exception 'v_org_kpi_status has % rows, the active part of the new view %', n_view, n_all_active;
  end if;

  -- And the new view really does carry everybody.
  select count(*) into n_all from v_org_kpi_status_all;
  select count(*) into n_employees from employees;
  if n_all < n_employees then
    raise exception 'v_org_kpi_status_all has % rows for % employees', n_all, n_employees;
  end if;

  -- The view built on the old one still reads.
  perform count(*) from v_manager_completion;

  if not has_table_privilege('authenticated', 'public.v_org_kpi_status_all', 'SELECT') then
    raise exception 'authenticated cannot read v_org_kpi_status_all';
  end if;

  if not exists (select 1 from pg_class
                 where oid = 'public.v_org_kpi_status_all'::regclass
                   and 'security_invoker=true' = any(reloptions)) then
    raise exception 'v_org_kpi_status_all must be security_invoker';
  end if;
  if not exists (select 1 from pg_class
                 where oid = 'public.v_org_kpi_status'::regclass
                   and 'security_invoker=true' = any(reloptions)) then
    raise exception 'v_org_kpi_status lost security_invoker';
  end if;

  raise notice '0116 self-test passed (% active rows unchanged, % rows including inactive)', n_view, n_all;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
