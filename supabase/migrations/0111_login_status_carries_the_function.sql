-- =====================================================================
-- Cyrix KPI  ·  0111  ·  login_status carries the function
--
-- Adoption is read by department and the answer is mostly "SERVICE": 959
-- of 1,181 active people sit in it, so a department breakdown is one row
-- that means everything and a dozen that mean almost nothing.
--
-- `function_name` is the split that matches how the company is actually
-- run -- RJBEMP, APBEMP, UPBEMP, KLBEMP, TCQAS, Care 360 -- and the
-- contracts are what a rollout is chased along. The view did not carry
-- it, so the page could not group by it.
--
-- Added rather than swapped: department is still what somebody's manager
-- calls their team, and both questions get asked.
--
-- The function that reads this view is unchanged. It already answers to
-- both is_sw_admin() and is_hr_admin(), which is why the same screen can
-- be shown to both without a second grant.
-- =====================================================================

create or replace view v_login_status as
select
  e.id as employee_id,
  e.ecode,
  e.full_name,
  e.designation,
  e.department,
  e.is_active,
  m.ecode as manager_ecode,
  m.full_name as manager_name,
  u.email as login_email,
  u.id is not null as has_login,
  e.password_is_default as on_issued_default,
  u.created_at as login_created_at,
  u.last_sign_in_at,
  u.updated_at as password_changed_at,
  case
    when u.id is null then 'No login issued'
    when e.password_is_default and u.last_sign_in_at is null then 'Never signed in'
    when e.password_is_default then 'Using the issued default'
    else 'Set their own password'
  end as login_state,
  -- Appended, not inserted. `create or replace view` may add columns at
  -- the end and may not reorder or rename the ones already there, and
  -- dropping the view would take login_status() with it -- the function
  -- returns SETOF this view.
  --
  -- Nullable and often blank: 89 active people have no function, so every
  -- reader needs somewhere to put "none", the same way it already handles
  -- a missing department.
  e.function_name
from employees e
  left join auth.users u on u.id = e.auth_user_id
  left join employees m on m.id = e.reporting_manager_id;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  n_cols int;
  n_rows int;
  n_functions int;
begin
  select count(*) into n_cols
  from information_schema.columns
  where table_name = 'v_login_status' and column_name = 'function_name';
  if n_cols <> 1 then
    raise exception 'v_login_status does not carry function_name';
  end if;

  -- The view still answers for everybody, not just those with a function.
  select count(*) into n_rows from v_login_status;
  if n_rows < (select count(*) from employees) then
    raise exception 'the view lost rows: % against % employees',
      n_rows, (select count(*) from employees);
  end if;

  select count(distinct coalesce(nullif(btrim(function_name), ''), '(none)'))
  into n_functions
  from v_login_status where is_active;
  if n_functions < 2 then
    raise exception 'expected several functions, found %', n_functions;
  end if;

  raise notice '0111 self-test passed (% rows, % distinct functions)',
    n_rows, n_functions;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
