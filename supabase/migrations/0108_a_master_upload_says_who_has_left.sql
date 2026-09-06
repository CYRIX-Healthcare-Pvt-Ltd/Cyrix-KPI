-- =====================================================================
-- Cyrix KPI  ·  0108  ·  A master upload says who has left
--
-- Management: uploading the employee master now deactivates anybody who
-- is not in the file. Their record, their KPI and every month they were
-- scored on stay exactly where they are -- only their login stops
-- working, which is the same thing "Approve and deactivate" does one
-- person at a time on the Leavers screen.
--
-- Deactivate rather than delete, deliberately and permanently: deleting
-- an employee row takes the appraisal history with it, and a year of
-- somebody's scoring is not something an HR upload should be able to
-- destroy by omission.
--
-- THE OBVIOUS DANGER, AND WHAT IS DONE ABOUT IT
--
-- This reads "everyone missing from the file has left", which is true of
-- a complete master and catastrophically false of a partial one. A
-- fifty-row correction file would otherwise mean eleven hundred people
-- lose their login at once.
--
-- Three things stand between that and a click:
--
--   1. An empty list is refused outright. A file that parsed to nothing
--      is the one case where the intent cannot be honest.
--   2. This returns the codes it deactivated rather than a count, so the
--      screen can name them before and after.
--   3. The screen states the number in the button itself -- "Import 50
--      and deactivate 1,101" is a sentence somebody stops reading.
--
-- What is deliberately NOT here is a percentage cap. A real
-- restructuring can be most of a branch, and a rule that blocks the
-- honest case to prevent the careless one just gets worked around.
-- =====================================================================

create or replace function deactivate_missing(p_ecodes text[])
returns table (ecode text, full_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  keep text[];
begin
  if not is_hr_admin() then
    raise exception 'Only HR Admin can deactivate employees';
  end if;

  keep := array(
    select distinct upper(btrim(x))
    from unnest(coalesce(p_ecodes, '{}'::text[])) as x
    where btrim(x) <> ''
  );

  -- The one case where "everyone is missing" cannot be what was meant.
  if array_length(keep, 1) is null then
    raise exception 'That file had no employee codes in it. Nothing was changed';
  end if;

  -- Their reports are left without a manager, exactly as
  -- review_tm_removal does it: HR reassigns explicitly rather than the
  -- system guessing who should inherit a team.
  update employees
  set reporting_manager_id = null
  where reporting_manager_id in (
    select e.id from employees e
    where e.is_active and not (upper(e.ecode) = any(keep))
  );

  return query
  with gone as (
    update employees e
    set is_active = false
    where e.is_active and not (upper(e.ecode) = any(keep))
    returning e.id, e.ecode, e.full_name
  ),
  logged as (
    select g.id,
           log_audit('employee', g.id, 'deactivated_by_master_upload',
                     jsonb_build_object('ecode', g.ecode)) as _
    from gone g
  )
  select g.ecode, g.full_name
  from gone g
  where exists (select 1 from logged l where l.id = g.id)
  order by g.ecode;
end $$;

revoke all on function deactivate_missing(text[]) from public;
grant execute on function deactivate_missing(text[]) to authenticated;

comment on function deactivate_missing(text[]) is
  'Deactivates active employees whose code is not in the list. Used by '
  'the master upload. Never deletes -- see 0108.';

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  hr_auth  uuid;
  emp_auth uuid;
  refused  boolean;
  n        int;
  still    boolean;
begin
  select auth_user_id into hr_auth from employees where ecode = 'HR_ADMIN';
  select auth_user_id into emp_auth from employees where ecode = 'E8888';
  if hr_auth is null or emp_auth is null then
    raise notice '0108 self-test skipped (HR_ADMIN or E8888 has no login)';
    return;
  end if;

  -- 1. An ordinary employee cannot do this.
  perform set_config('request.jwt.claims',
    json_build_object('sub', emp_auth, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform deactivate_missing(array['E1']);
  exception when others then
    if sqlerrm like '%Only HR Admin%' then refused := true; else raise; end if;
  end;
  if not refused then raise exception 'an employee deactivated the company'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_auth, 'role', 'authenticated')::text, true);

  -- 2. An empty list changes nothing rather than everything.
  refused := false;
  begin
    perform deactivate_missing(array[]::text[]);
  exception when others then
    if sqlerrm like '%no employee codes%' then refused := true; else raise; end if;
  end;
  if not refused then raise exception 'an empty file deactivated everybody'; end if;
  select count(*)::int into n from employees where not is_active;
  if n <> 0 then raise exception 'the empty call still deactivated % people', n; end if;

  -- 3. Keeping everyone but E8888 deactivates exactly E8888, and is
  --    case-insensitive about the codes it was given.
  select count(*)::int into n from (
    select * from deactivate_missing(
      array(select lower(ecode) from employees where is_active and ecode <> 'E8888'))
  ) x;
  if n <> 1 then raise exception 'expected 1 deactivation, got %', n; end if;
  select is_active into still from employees where ecode = 'E8888';
  if still then raise exception 'E8888 is still active'; end if;

  -- 4. Their history is untouched. That is the whole reason for this
  --    rather than a delete.
  if not exists (select 1 from kpi_submissions s
                 join employees e on e.id = s.employee_id
                 where e.ecode = 'E8888')
     and not exists (select 1 from employees where ecode = 'E8888') then
    raise exception 'E8888 was removed rather than deactivated';
  end if;

  raise notice '0108 self-test passed (role, empty refused, exact set, record kept)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
