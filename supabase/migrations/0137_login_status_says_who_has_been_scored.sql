-- =====================================================================
-- Cyrix KPI  ·  0137  ·  login_status says who has been scored
--
-- Rollout is chased on two questions: has this person got a KPI, and has
-- anything actually been assessed against it. The Summary Report could
-- answer the first (0115) and not the second, so "how many people have
-- had at least one month scored" was not on any admin screen -- HR's
-- overview carried it only as small print under a tile counting months,
-- and SW admin did not carry it at all.
--
-- One column, months_scored, on the view both admin roles already read
-- through the same security-definer function. No new grant, no second
-- request, and the two screens cannot drift apart because they are now
-- counting the same rows by the same rule.
--
-- The body below is the live definition read back with pg_get_viewdef,
-- with the one column spliced onto the end. Nothing was retyped.
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
    COALESCE(( SELECT a.status
           FROM kpi_assignments a
             JOIN financial_years f ON f.code = a.financial_year
          WHERE a.employee_id = e.id AND CURRENT_DATE >= f.starts_on AND CURRENT_DATE <= f.ends_on
          ORDER BY a.updated_at DESC NULLS LAST
         LIMIT 1), 'not_set_up'::text) AS kpi_status,
    -- Appended, as kpi_status was in 0115 and function_name in 0111: create
    -- or replace view may add columns at the end and may not move the ones
    -- already there, and dropping the view would take login_status() with
    -- it. The function returns SETOF this view, so it widens with it and
    -- needs no change of its own.
    --
    -- Scored months this financial year, counted the way v_org_kpi_status
    -- counts them, so HR's figure and SW's are the same figure: a month
    -- the manager has scored ('scored') or one signed off after that
    -- ('finalized'). Submitted-and-waiting is not scored.
    (( SELECT count(*)
           FROM kpi_submissions s
             JOIN financial_years f2 ON f2.code = s.financial_year
          WHERE s.employee_id = e.id
            AND CURRENT_DATE >= f2.starts_on AND CURRENT_DATE <= f2.ends_on
            AND (s.status = ANY (ARRAY['scored'::text, 'finalized'::text]))))::integer AS months_scored
   FROM employees e
     LEFT JOIN auth.users u ON u.id = e.auth_user_id
     LEFT JOIN employees m ON m.id = e.reporting_manager_id;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  last_col    text;
  n_rows      int;
  n_employees int;
  n_view      int;
  n_direct    int;
begin
  select column_name into last_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'v_login_status'
  order by ordinal_position desc limit 1;
  if last_col is distinct from 'months_scored' then
    raise exception 'months_scored should be the last column of v_login_status, found %', last_col;
  end if;

  -- Still one row per employee: the subquery adds a column, never a row.
  select count(*) into n_rows from v_login_status;
  select count(*) into n_employees from employees;
  if n_rows <> n_employees then
    raise exception 'the view has % rows for % employees', n_rows, n_employees;
  end if;

  -- The view's count of people scored at least once agrees with the tables.
  select count(*) into n_view from v_login_status where is_active and months_scored > 0;
  select count(distinct s.employee_id) into n_direct
  from kpi_submissions s
  join employees e on e.id = s.employee_id and e.is_active
  join financial_years f on f.code = s.financial_year
  where current_date between f.starts_on and f.ends_on
    and s.status in ('scored', 'finalized');
  if n_view <> n_direct then
    raise exception 'the view says % people scored, the tables say %', n_view, n_direct;
  end if;

  -- The function built on this view still runs, and now returns the
  -- wider row type. As a direct connection neither admin check passes.
  perform count(*) from login_status();

  raise notice '0137 self-test passed (% rows, % people scored at least once)', n_rows, n_view;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
