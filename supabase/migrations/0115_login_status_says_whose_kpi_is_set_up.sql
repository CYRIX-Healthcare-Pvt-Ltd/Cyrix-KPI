-- =====================================================================
-- Cyrix KPI  ·  0115  ·  login_status says whose KPI is set up
--
-- The Summary Report counts, per manager, how many of their people have
-- signed in. The next question asked of the same rows is how many of
-- those people have a KPI to sign in to -- "2 / 10 set up" -- and the
-- view the report reads did not carry it.
--
-- Added here rather than fetched from v_org_kpi_status. That view is
-- security_invoker, so an SW admin reading it gets the rows their own
-- policies allow, which is not everybody; login_status() is the
-- security-definer function the report already calls, gated to both admin
-- roles, so the count reaches SW and HR alike with no second request and
-- no new grant.
--
-- The status is the assignment's own word: active (approved),
-- pending_approval, draft, rejected, or not_set_up where there is no
-- assignment for the year. The screen decides that only 'active' counts as
-- set up; the view does not pre-judge it.
--
-- The view body below is the live definition read back with
-- pg_get_viewdef, with the one column spliced onto the end. Nothing was
-- retyped.
-- =====================================================================

create or replace view v_login_status as
SELECT e.id AS employee_id,
    e.ecode,
    e.full_name,
    e.designation,
    e.department,
    e.is_active,
    m.ecode AS manager_ecode,
    m.full_name AS manager_name,
    u.email AS login_email,
    u.id IS NOT NULL AS has_login,
    e.password_is_default AS on_issued_default,
    u.created_at AS login_created_at,
    u.last_sign_in_at,
    u.updated_at AS password_changed_at,
        CASE
            WHEN u.id IS NULL THEN 'No login issued'::text
            WHEN e.password_is_default AND u.last_sign_in_at IS NULL THEN 'Never signed in'::text
            WHEN e.password_is_default THEN 'Using the issued default'::text
            ELSE 'Set their own password'::text
        END AS login_state,
    e.function_name,
    -- Appended, as 0111 appended function_name: create or replace view may
    -- add columns at the end and may not move the ones already there, and
    -- dropping the view would take login_status() with it.
    --
    -- This year's KPI only. Last year's approved KPI is not a KPI set up for
    -- this year; the year is the one today falls in, found the way
    -- open_submission finds the year a month belongs to.
    coalesce((
      select a.status
      from kpi_assignments a
      join financial_years f on f.code = a.financial_year
      where a.employee_id = e.id
        and current_date between f.starts_on and f.ends_on
      order by a.updated_at desc nulls last
      limit 1
    ), 'not_set_up') as kpi_status
   FROM employees e
     LEFT JOIN auth.users u ON u.id = e.auth_user_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  last_col        text;
  n_rows          int;
  n_employees     int;
  n_view_active   int;
  n_direct_active int;
  n_bad           int;
begin
  select column_name into last_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_login_status'
  order by ordinal_position desc limit 1;
  if last_col is distinct from 'kpi_status' then
    raise exception 'kpi_status should be the last column of v_login_status, found %', last_col;
  end if;

  -- Still one row per employee: the subquery adds a column, never a row.
  select count(*) into n_rows from v_login_status;
  select count(*) into n_employees from employees;
  if n_rows <> n_employees then
    raise exception 'the view has % rows for % employees', n_rows, n_employees;
  end if;

  -- The view's count of approved KPIs agrees with the tables.
  select count(*) into n_view_active
  from v_login_status where is_active and kpi_status = 'active';
  select count(*) into n_direct_active
  from employees e
  join kpi_assignments a on a.employee_id = e.id and a.status = 'active'
  join financial_years f on f.code = a.financial_year
  where e.is_active and current_date between f.starts_on and f.ends_on;
  if n_view_active <> n_direct_active then
    raise exception 'the view says % approved KPIs, the tables say %', n_view_active, n_direct_active;
  end if;

  select count(*) into n_bad from v_login_status
  where kpi_status not in ('active', 'pending_approval', 'draft', 'rejected', 'not_set_up');
  if n_bad > 0 then
    raise exception '% row(s) carry a kpi_status outside the known five', n_bad;
  end if;

  -- The function built on this view still runs. As a direct connection
  -- neither admin check passes, so it returns nothing -- but it has to work
  -- against the wider row type to get that far.
  perform count(*) from login_status();

  raise notice '0115 self-test passed (% rows, % approved KPIs this year)', n_rows, n_view_active;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
