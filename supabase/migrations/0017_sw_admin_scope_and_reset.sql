-- =====================================================================
-- Cyrix KPI  ·  0017  ·  Keep SW Admin out of appraisal, and give it a
--                        testing-phase reset
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SW Admin is technical support, not part of the appraisal chain.
--
-- 0015 put the record-request queue in front of it. That was wrong: the
-- two stages are the reporting manager and HR, deliberately, because
-- they are the two people with standing to judge whether a month should
-- be erased. SW Admin resets logins. Deletion reasons name an employee,
-- a month and why their record is disputed, which is appraisal content
-- and none of its business.
--
-- Removing the nav link alone would be theatre — the row would still be
-- readable to anyone who typed the URL. The read policies go too.
-- ---------------------------------------------------------------------
drop policy if exists deletion_read on record_deletion_requests;
create policy deletion_read on record_deletion_requests for select to authenticated
using (
  requested_by = current_employee_id()
  or employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin()
);

drop policy if exists revision_read on kpi_revision_requests;
create policy revision_read on kpi_revision_requests for select to authenticated
using (
  requested_by = current_employee_id()
  or employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin()
);


-- ---------------------------------------------------------------------
-- 2. An explicit testing-phase flag.
--
-- The two existing relaxations are about passwords and were being read
-- as a proxy for "we are still trialling this". They are not the same
-- question, and the next thing gates on the answer, so it gets its own
-- setting rather than inferring it.
-- ---------------------------------------------------------------------
insert into app_settings (key, value, description) values (
  'testing_mode', 'true'::jsonb,
  'True while the system is being trialled with throwaway data. Permits '
  'SW Admin to wipe one employee''s KPI history outright. Set to false '
  'before real appraisal data is entered — after that, removing a month '
  'goes through the manager and HR like everything else.'
) on conflict (key) do update set description = excluded.description;


-- ---------------------------------------------------------------------
-- 3. Clearing one employee back to nothing.
--
-- This deliberately contradicts the governance in 0012 and 0015, where
-- erasing a single scored month needs the reporting manager and then HR.
-- A button that erases a whole year in one click cannot coexist with
-- that rule once the data is real, so it is gated three ways:
--
--   · SW Admin only
--   · testing_mode must still be on
--   · the caller has to type the employee code back
--
-- The last one is not ceremony. The console lists 1,148 people and the
-- reset button sits on a row; typing the code is what makes hitting the
-- wrong row impossible rather than merely unlikely.
--
-- Everything is written to the audit log first, including the month
-- totals, so the numbers survive the rows.
-- ---------------------------------------------------------------------
create or replace function sw_reset_employee_data(
  p_employee_id uuid, p_confirm_ecode text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  emp       record;
  testing   boolean;
  snapshot  jsonb;
  n_subs    integer;
  n_assign  integer;
begin
  if not is_sw_admin() then
    raise exception 'Only SW Admin can clear an employee''s KPI data';
  end if;

  select coalesce(value::text::boolean, false) into testing
  from app_settings where key = 'testing_mode';

  if not coalesce(testing, false) then
    raise exception
      'Testing mode is off. Removing a record now goes through the '
      'reporting manager and HR.';
  end if;

  select e.id, e.ecode, e.full_name into emp
  from employees e where e.id = p_employee_id;
  if not found then raise exception 'Employee not found'; end if;

  if upper(trim(coalesce(p_confirm_ecode, ''))) <> upper(emp.ecode) then
    raise exception 'Type % to confirm. Nothing was changed.', upper(emp.ecode);
  end if;

  -- The numbers, before they go.
  select jsonb_build_object(
    'ecode', emp.ecode,
    'full_name', emp.full_name,
    'months', coalesce(jsonb_agg(jsonb_build_object(
        'period', s.period_month, 'status', s.status,
        'self_total', s.self_total_score,
        'manager_total', s.mgr_total_score,
        'final_total', s.final_total_score
      ) order by s.period_month), '[]'::jsonb))
  into snapshot
  from kpi_submissions s where s.employee_id = emp.id;

  perform log_audit('employee', emp.id, 'sw_reset_kpi_data', snapshot);

  -- Requests first: they reference the rows about to go, and a deletion
  -- request outliving its submission would be an orphan asking for
  -- something that no longer exists.
  delete from record_deletion_requests where employee_id = emp.id;
  delete from kpi_revision_requests where employee_id = emp.id;

  -- Submissions before assignments: the FK between them is RESTRICT, on
  -- purpose, so a year's definition cannot be pulled out from under
  -- months that were scored against it.
  with gone as (
    delete from kpi_submissions where employee_id = emp.id returning 1
  ) select count(*)::int into n_subs from gone;

  with gone as (
    delete from kpi_assignments where employee_id = emp.id returning 1
  ) select count(*)::int into n_assign from gone;

  return jsonb_build_object(
    'ok', true,
    'ecode', emp.ecode,
    'full_name', emp.full_name,
    'submissions_removed', n_subs,
    'assignments_removed', n_assign);
end $$;

comment on function sw_reset_employee_data(uuid, text) is
  'Testing-phase only. Deletes every KPI assignment and submission for '
  'one employee, after writing the month totals to the audit log. The '
  'employee record and login are untouched.';

revoke all on function sw_reset_employee_data(uuid, text) from public, anon;
grant execute on function sw_reset_employee_data(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Reading the function's own source proves what it says, not that it
-- runs: a plpgsql body is only parsed when it executes, so an invented
-- column name sails past every string assertion below. The first check
-- therefore executes the snapshot query itself against a false predicate
-- — no rows, full parse — which is what catches it.
--
-- The destructive path is exercised separately, in a transaction that
-- rolls back.
-- ---------------------------------------------------------------------
do $$
declare
  src text := pg_get_functiondef('sw_reset_employee_data(uuid,text)'::regprocedure);
  n   integer;
begin
  -- Every column the audit snapshot names must actually exist.
  perform jsonb_build_object(
    'months', coalesce(jsonb_agg(jsonb_build_object(
        'period', s.period_month, 'status', s.status,
        'self_total', s.self_total_score,
        'manager_total', s.mgr_total_score,
        'final_total', s.final_total_score
      )), '[]'::jsonb))
  from kpi_submissions s where false;

  if src not like '%is_sw_admin()%' then
    raise exception 'reset must be restricted to SW Admin';
  end if;
  if src not like '%testing_mode%' then
    raise exception 'reset must be gated on testing_mode';
  end if;
  if src not like '%p_confirm_ecode%' then
    raise exception 'reset must require the ecode typed back';
  end if;

  -- Ordering is load-bearing: submissions hold a RESTRICT reference to
  -- the assignment, so deleting the assignment first would abort.
  if position('from kpi_submissions where employee_id' in src)
     > position('from kpi_assignments where employee_id' in src) then
    raise exception 'submissions must be deleted before assignments';
  end if;

  -- SW Admin must no longer see appraisal requests.
  select count(*) into n from pg_policies
  where tablename in ('record_deletion_requests','kpi_revision_requests')
    and policyname in ('deletion_read','revision_read')
    and qual like '%is_sw_admin%';
  if n <> 0 then
    raise exception 'SW Admin still has read access to % request policy(ies)', n;
  end if;

  raise notice '0017 self-test passed';
end $$;
