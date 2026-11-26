-- =====================================================================
-- Cyrix KPI  ·  0314  ·  A deactivated employee cannot sign in
--
-- Audit finding M5 (the user, 26 Nov 2026: "whatttt?"): 120 employees were
-- inactive but their logins were never banned; 13 signed in during the
-- last 30 days, some weeks after being deactivated. Most data was already
-- closed to them (current_employee_id() checks is_active), but rules that
-- only ask "signed in?" let them through, and is_hr_admin() / is_sw_admin()
-- did not check is_active.
--
--   1. The login follows the employee row: deactivated → banned; made
--      active again → unbanned. Done by a trigger, so every way of
--      deactivating (SW Admin, HR, employee-master upload) is covered.
--   2. The inactive employees' logins are banned now.
--   3. is_hr_admin() and is_sw_admin() require an active employee.
-- =====================================================================

create or replace function public.employees_login_follows_active()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.auth_user_id is null then return new; end if;
  if not new.is_active then
    update auth.users set banned_until = 'infinity'
    where id = new.auth_user_id and (banned_until is null or banned_until < 'infinity');
  elsif tg_op = 'UPDATE' and (not old.is_active or old.auth_user_id is distinct from new.auth_user_id) then
    update auth.users set banned_until = null
    where id = new.auth_user_id and banned_until = 'infinity';
  end if;
  return new;
end $$;

revoke all on function public.employees_login_follows_active() from public, anon, authenticated;

drop trigger if exists trg_employees_login_follows_active on public.employees;
create trigger trg_employees_login_follows_active
after insert or update of is_active, auth_user_id on public.employees
for each row execute function public.employees_login_follows_active();

-- 2. Everyone inactive today.
update auth.users u set banned_until = 'infinity'
from public.employees e
where e.auth_user_id = u.id and not e.is_active
  and (u.banned_until is null or u.banned_until < 'infinity');

-- 3. Role helpers: an inactive employee holds no role.
CREATE OR REPLACE FUNCTION public.is_hr_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from user_roles ur
    join employees e on e.id = ur.employee_id
    where e.auth_user_id = auth.uid()
      and e.is_active
      and ur.role in ('hr_admin','super_admin')
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_sw_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from user_roles ur
    join employees e on e.id = ur.employee_id
    where e.auth_user_id = auth.uid()
      and e.is_active
      and ur.role = 'sw_admin'
  );
$function$;
