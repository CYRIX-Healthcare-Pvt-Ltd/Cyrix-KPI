-- =====================================================================
-- Cyrix KPI  ·  0059  ·  SW Admin administers Spare too
--
-- 0058 seeded Spare's admins from user_roles matching
-- ('hr_admin', 'super_admin'). 'super_admin' is the name in 0001's check
-- constraint; 0012 replaced it with 'sw_admin' and nobody has ever held
-- the old name. So the seed matched HR Admin and silently missed the
-- account whose entire remit is administering the software.
--
-- Silently is the problem: no row failed and no constraint complained,
-- because a name that matches nothing is indistinguishable from a name
-- that matches nobody yet. The self-test asked whether ANY admin existed
-- and one did, so it passed.
--
-- Read from user_roles rather than naming roles again here, so this stays
-- correct if the set changes once more.
-- =====================================================================

update profiles p
set role = 'admin'::user_role
from employees e
join user_roles ur on ur.employee_id = e.id
where p.id = e.auth_user_id
  and ur.role in ('hr_admin', 'sw_admin')
  and p.role <> 'admin';


-- ---------------------------------------------------------------------
-- Keep it true for people who become admins later. 0058 syncs identity
-- from employees; this syncs the one role that is genuinely KPI's to
-- decide. Which facilities somebody manages stays Spare's business.
-- ---------------------------------------------------------------------
create or replace function public.spare_sync_admin_from_user_roles()
returns trigger
language plpgsql security definer set search_path = public as $sync_admin$
declare
  target uuid;
begin
  select e.auth_user_id into target
  from employees e
  where e.id = coalesce(new.employee_id, old.employee_id);

  if target is null then
    return coalesce(new, old);
  end if;

  perform set_config('spare.syncing', 'on', true);

  update profiles set role =
    case when exists (
      select 1 from user_roles ur
      join employees e2 on e2.id = ur.employee_id
      where e2.auth_user_id = target and ur.role in ('hr_admin', 'sw_admin')
    ) then 'admin'::user_role
    -- Demotion returns them to engineer, not to project_manager: a
    -- facility promotion is Spare's to re-apply, and guessing it back
    -- would hand out access nobody granted.
    else 'engineer'::user_role end
  where id = target;

  return coalesce(new, old);
end $sync_admin$;

drop trigger if exists trg_user_roles_sync_spare_admin on user_roles;
create trigger trg_user_roles_sync_spare_admin
  after insert or update or delete on user_roles
  for each row execute function public.spare_sync_admin_from_user_roles();


-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n_admin   integer;
  n_expect  integer;
  probe_emp uuid;
  probe_auth uuid;
begin
  select count(*) into n_expect
  from employees e
  where e.auth_user_id is not null
    and exists (select 1 from user_roles ur
                where ur.employee_id = e.id and ur.role in ('hr_admin', 'sw_admin'));

  select count(*) into n_admin from profiles where role = 'admin';

  if n_admin <> n_expect then
    raise exception 'Spare has % admins but % people hold an admin role in KPI',
      n_admin, n_expect;
  end if;
  if n_admin < 2 then
    raise exception 'Expected both HR Admin and SW Admin to administer Spare, found %', n_admin;
  end if;

  -- Granting the role in KPI reaches Spare without a second step.
  select e.id, e.auth_user_id into probe_emp, probe_auth
  from employees e
  where e.auth_user_id is not null
    and not exists (select 1 from user_roles ur where ur.employee_id = e.id)
  order by e.ecode limit 1;

  if probe_emp is not null then
    insert into user_roles (employee_id, role) values (probe_emp, 'sw_admin');
    if not exists (select 1 from profiles where id = probe_auth and role = 'admin') then
      raise exception 'Granting sw_admin in KPI did not make them a Spare admin';
    end if;

    delete from user_roles where employee_id = probe_emp and role = 'sw_admin';
    if exists (select 1 from profiles where id = probe_auth and role = 'admin') then
      raise exception 'Revoking sw_admin left them an admin in Spare';
    end if;
  end if;

  raise notice '0059 self-test passed (% Spare admins, matching KPI)', n_admin;
end $selftest$;
