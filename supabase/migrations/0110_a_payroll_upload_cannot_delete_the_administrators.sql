-- =====================================================================
-- Cyrix KPI  ·  0110  ·  A payroll upload cannot deactivate the admins
--
-- HR_ADMIN and SW_ADMIN were deactivated by a routine employee master
-- upload, and so were the two test accounts. Nobody did anything wrong:
-- deactivate_missing switches off everyone whose code is not in the
-- uploaded sheet, and none of those four is on a payroll sheet, because
-- none of them is a person being paid. They would have gone again on the
-- next upload, and every upload after that.
--
-- The sheet is the truth about who is employed. It is not the truth about
-- who has an account. Those are different questions and the function was
-- answering the second with the first.
--
-- WHY A COLUMN RATHER THAN A ROLE TEST
--
-- Skipping anything with an admin role in `user_roles` would have saved
-- HR_ADMIN and SW_ADMIN and still lost E8888 and E9999, which hold no
-- role at all — they exist to be an ordinary employee and an ordinary
-- manager for testing. It would also have made the rule invisible: the
-- reason an account survived would live in a join two tables away.
--
-- `payroll_managed` says the thing out loud, on the row, in one word, and
-- HR can see it. True for everybody by default, so a new joiner is
-- covered by the sheet exactly as before and nothing has to be remembered
-- when somebody is hired.
-- =====================================================================

alter table employees
  add column if not exists payroll_managed boolean not null default true;

comment on column employees.payroll_managed is
  'Whether the employee master upload governs this account. False for '
  'accounts that are not people on a payroll -- administrators and test '
  'logins -- which a sheet can never contain and must not switch off.';

-- ---------------------------------------------------------------------
-- The accounts that are not payroll.
--
-- By role, so any future administrator is covered without a second
-- migration, and by code for the two test logins, which deliberately hold
-- no role because they stand in for ordinary users.
-- ---------------------------------------------------------------------
update employees e
set payroll_managed = false
where exists (
  select 1 from user_roles ur
  where ur.employee_id = e.id
    and ur.role in ('hr_admin', 'super_admin')
);

update employees
set payroll_managed = false
where upper(ecode) in ('HR_ADMIN', 'SW_ADMIN', 'E8888', 'E9999');

-- ---------------------------------------------------------------------
-- Undo what the upload did to them.
--
-- Only these accounts, and only the ones an upload switched off. Real
-- leavers stay deactivated -- that part of the upload was correct and is
-- the whole point of it.
-- ---------------------------------------------------------------------
update employees
set is_active = true
where not payroll_managed and not is_active;

-- ---------------------------------------------------------------------
-- And the function stops reaching them.
-- ---------------------------------------------------------------------
create or replace function public.deactivate_missing(p_ecodes text[])
returns table(ecode text, full_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    where e.is_active and e.payroll_managed and not (upper(e.ecode) = any(keep))
  );

  return query
  with gone as (
    update employees e
    set is_active = false
    where e.is_active
      -- Added by 0110. An account that is not on the payroll cannot be
      -- absent from a payroll sheet in any meaningful sense.
      and e.payroll_managed
      and not (upper(e.ecode) = any(keep))
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
end $function$;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  n_exempt int;
  n_inactive_exempt int;
  still_off int;
begin
  select count(*) into n_exempt from employees where not payroll_managed;
  select count(*) into n_inactive_exempt
  from employees where not payroll_managed and not is_active;

  if n_exempt < 4 then
    raise exception 'expected at least the four known non-payroll accounts, found %', n_exempt;
  end if;
  if n_inactive_exempt <> 0 then
    raise exception '% non-payroll accounts are still deactivated', n_inactive_exempt;
  end if;

  -- The four by name, since they are the ones this exists for.
  if exists (
    select 1 from employees
    where upper(ecode) in ('HR_ADMIN', 'SW_ADMIN', 'E8888', 'E9999')
      and (payroll_managed or not is_active)
  ) then
    raise exception 'a named non-payroll account is still managed or still off';
  end if;

  -- An upload that lists nobody must now leave them alone. Simulated by
  -- the same predicate the function uses, rather than by calling it --
  -- calling it needs an HR Admin session, which a migration is not.
  select count(*) into still_off
  from employees e
  where e.is_active and e.payroll_managed
    and not (upper(e.ecode) = any (array['NOBODY']::text[]))
    and upper(e.ecode) in ('HR_ADMIN', 'SW_ADMIN', 'E8888', 'E9999');
  if still_off <> 0 then
    raise exception 'the exemption does not hold inside the function''s own test';
  end if;

  raise notice '0110 self-test passed (% non-payroll accounts, all active)', n_exempt;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
