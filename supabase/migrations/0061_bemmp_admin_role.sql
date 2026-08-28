-- =====================================================================
-- Cyrix KPI  ·  0061  ·  BEMMP's admins are 'admin', not 'director'
--
-- 0060 seeded HR Admin and SW Admin into BEMMP as 'director', reading
-- app_role from migration 0001 where the values are director,
-- project_head, coordinator and purchase. Later BEMMP migrations extended
-- that enum, and one of the values they added is 'admin' — which is
-- precisely what bemmp_is_admin() tests for:
--
--   select role::text = 'admin' from profile where id = auth.uid()
--
-- So the two accounts meant to administer BEMMP were seeded into a role
-- that is not the one its own permission check asks about. Nothing
-- errored. profile_self and profile_admin_write both hang off that
-- function, so both simply answered false: neither admin could read
-- anybody else's BEMMP profile, let alone change one.
--
-- The same shape of mistake as 0059 — a role name taken from the earliest
-- migration that defines it rather than from what the database actually
-- holds — so this reads the enum instead of trusting a second reading of
-- the files.
-- =====================================================================

do $check$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'admin'
  ) then
    raise exception 'app_role has no admin value; bemmp_is_admin() can never be true';
  end if;
end $check$;

update profile p
set role = 'admin'::app_role
from employees e
join user_roles ur on ur.employee_id = e.id
where p.id = e.auth_user_id
  and ur.role in ('hr_admin', 'sw_admin')
  and p.role <> 'admin'::app_role;


-- ---------------------------------------------------------------------
-- Keep it true as the admin roles change, the way 0059 does for Spare.
-- Demotion returns them to coordinator rather than guessing at whichever
-- BEMMP role they held before: the zone and district scopes are set
-- inside BEMMP, and inventing a role here would hand out a view of the
-- business nobody granted.
-- ---------------------------------------------------------------------
create or replace function public.bemmp_sync_admin_from_user_roles()
returns trigger
language plpgsql security definer set search_path = public as $sync$
declare
  target uuid;
begin
  select e.auth_user_id into target
  from employees e
  where e.id = coalesce(new.employee_id, old.employee_id);

  if target is null then
    return coalesce(new, old);
  end if;

  update profile set role =
    case when exists (
      select 1 from user_roles ur
      join employees e2 on e2.id = ur.employee_id
      where e2.auth_user_id = target and ur.role in ('hr_admin', 'sw_admin')
    ) then 'admin'::app_role
    else 'coordinator'::app_role end
  where id = target;

  return coalesce(new, old);
end $sync$;

drop trigger if exists trg_user_roles_sync_bemmp_admin on user_roles;
create trigger trg_user_roles_sync_bemmp_admin
  after insert or update or delete on user_roles
  for each row execute function public.bemmp_sync_admin_from_user_roles();


-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n_admin  integer;
  n_expect integer;
begin
  select count(*) into n_expect
  from employees e
  where e.auth_user_id is not null
    and exists (select 1 from user_roles ur
                where ur.employee_id = e.id and ur.role in ('hr_admin', 'sw_admin'));

  select count(*) into n_admin from profile where role = 'admin'::app_role;

  if n_admin <> n_expect then
    raise exception 'BEMMP has % admins but % people administer the system', n_admin, n_expect;
  end if;
  if n_admin < 2 then
    raise exception 'Expected both HR Admin and SW Admin to administer BEMMP, found %', n_admin;
  end if;

  -- The whole point: the function BEMMP's policies ask now answers yes for
  -- them. Asserted against the definition rather than the role name, so a
  -- future rename cannot quietly reintroduce the same mismatch.
  if not exists (
    select 1 from profile p
    where p.role::text = 'admin'
      and exists (select 1 from employees e join user_roles ur on ur.employee_id = e.id
                  where e.auth_user_id = p.id and ur.role in ('hr_admin','sw_admin'))
  ) then
    raise exception 'No system administrator satisfies bemmp_is_admin()';
  end if;

  raise notice '0061 self-test passed (% BEMMP admins)', n_admin;
end $selftest$;
