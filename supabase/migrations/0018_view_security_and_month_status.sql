-- =====================================================================
-- Cyrix KPI  ·  0018  ·  Make the reporting views obey RLS,
--                        and add month-by-month manager status
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The reporting views were bypassing every row-level policy.
--
-- A view in Postgres 15 runs with its OWNER's rights unless it is
-- explicitly marked security_invoker. These were all created by
-- postgres, and granted to authenticated, so selecting from one ignored
-- the 33 policies in 0006 entirely.
--
-- Measured before this migration: a plain team member — no reports, no
-- role — read all 1,148 rows of v_org_kpi_status, including other
-- people's appraisal averages. Every policy protecting the base tables
-- was correct and every one of them was routed around.
--
-- security_invoker makes the view resolve as whoever is querying it, so
-- the existing policies apply and each caller sees exactly the rows they
-- already had rights to: a team member their own, a manager their team,
-- HR everyone.
-- ---------------------------------------------------------------------
alter view v_annual_kra_scores   set (security_invoker = true);
alter view v_annual_summary      set (security_invoker = true);
alter view v_employee_weak_areas set (security_invoker = true);
alter view v_kra_attainment      set (security_invoker = true);
alter view v_manager_completion  set (security_invoker = true);
alter view v_manager_tat         set (security_invoker = true);
alter view v_org_kpi_status      set (security_invoker = true);
alter view v_team_status         set (security_invoker = true);

-- v_login_status is the exception and stays on owner rights, because it
-- reads auth.users, which no application role can be granted. It was
-- also readable by every authenticated user, which is the same bug in a
-- different shape. The login_status() function has always been the
-- intended door — it checks the caller's role — so close the other one.
revoke select on v_login_status from authenticated;


-- ---------------------------------------------------------------------
-- 2. Month-by-month status per manager.
--
-- Everything HR had was cumulative: how many KPIs are approved, how many
-- months are outstanding in total. That answers "are we behind" and not
-- "who has not done June", which is the question actually asked when
-- chasing people.
--
-- One view serves both audiences, because it is the same shape read two
-- ways: HR filters to a month and reads every manager; a manager filters
-- to themselves and reads every month. security_invoker does the
-- scoping, so a manager cannot read anyone else's row.
--
-- Months come from the financial year rather than from the submissions,
-- so a manager who has done nothing at all still appears — which is the
-- entire point of the report.
-- ---------------------------------------------------------------------
create or replace view v_manager_month_status
with (security_invoker = true) as
with months as (
  select fy.code as financial_year, gs::date as period_month
  from financial_years fy
  cross join lateral generate_series(
    fy.starts_on, fy.ends_on, interval '1 month') gs
)
select
  mo.financial_year,
  mo.period_month,
  mgr.id                                  as manager_id,
  mgr.ecode                               as manager_ecode,
  mgr.full_name                           as manager_name,
  mgr.department,
  count(tm.id)::int                       as team_size,
  count(*) filter (
    where sub.id is null or sub.status = 'draft')::int   as not_submitted,
  count(*) filter (where sub.status = 'submitted')::int  as awaiting_manager,
  count(*) filter (where sub.status = 'returned')::int   as returned,
  count(*) filter (
    where sub.status in ('scored','finalized'))::int     as scored,
  round(avg(sub.final_total_score) filter (
    where sub.status in ('scored','finalized')), 2)      as team_avg_score
from months mo
join employees tm on tm.is_active and tm.reporting_manager_id is not null
join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
left join kpi_submissions sub
       on sub.employee_id = tm.id and sub.period_month = mo.period_month
group by mo.financial_year, mo.period_month,
         mgr.id, mgr.ecode, mgr.full_name, mgr.department;

grant select on v_manager_month_status to authenticated;

comment on view v_manager_month_status is
  'One row per manager per month of the financial year. Managers with no '
  'activity still appear, because "who has not done June" is the question '
  'this exists to answer.';


-- ---------------------------------------------------------------------
-- Self-test: who can see what, checked as three real roles.
--
-- These assertions are the point of the migration, so they run against
-- actual accounts rather than inspecting catalogue flags.
-- ---------------------------------------------------------------------
do $$
declare
  tm_uid   uuid;
  mgr_uid  uuid;
  hr_uid   uuid;
  mgr_id   uuid;
  n_all    integer;
  n_tm     integer;
  n_mgr    integer;
  n_hr     integer;
  team     integer;
begin
  select count(*) into n_all from employees where is_active;

  -- Somebody with no reports and no role.
  select e.auth_user_id into tm_uid from employees e
  where e.auth_user_id is not null and e.is_active
    and e.id not in (select employee_id from user_roles)
    and e.id not in (select distinct reporting_manager_id from employees
                     where reporting_manager_id is not null)
  limit 1;

  select e.auth_user_id, e.id into mgr_uid, mgr_id from employees e
  join employees t on t.reporting_manager_id = e.id and t.is_active
  where e.auth_user_id is not null and e.is_active
    and e.id not in (select employee_id from user_roles)
  group by e.auth_user_id, e.id order by count(*) desc limit 1;

  select e.auth_user_id into hr_uid from employees e
  join user_roles ur on ur.employee_id = e.id
  where ur.role = 'hr_admin' limit 1;

  select count(*) into team from employees
  where reporting_manager_id = mgr_id and is_active;

  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', tm_uid::text, 'role','authenticated')::text, true);
  select count(*) into n_tm from v_org_kpi_status;

  perform set_config('request.jwt.claims',
    json_build_object('sub', mgr_uid::text, 'role','authenticated')::text, true);
  select count(*) into n_mgr from v_org_kpi_status;

  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_uid::text, 'role','authenticated')::text, true);
  select count(*) into n_hr from v_org_kpi_status;

  reset role;

  if n_tm >= n_all then
    raise exception
      'A team member still reads the whole company: % of % rows', n_tm, n_all;
  end if;
  if n_mgr >= n_all then
    raise exception
      'A manager still reads the whole company: % of % rows', n_mgr, n_all;
  end if;
  if n_mgr < team then
    raise exception
      'A manager can no longer see their own team: % rows for % reports',
      n_mgr, team;
  end if;
  if n_hr <> n_all then
    raise exception
      'HR must still see everyone: % of % rows', n_hr, n_all;
  end if;

  raise notice
    '0018 self-test passed — team member %, manager % (team %), HR % of %',
    n_tm, n_mgr, team, n_hr, n_all;
end $$;
