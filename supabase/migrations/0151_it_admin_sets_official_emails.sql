-- =====================================================================
-- Cyrix KPI · 0151 · IT_ADMIN: the Logins tab, and the email field only
--
-- The user, 8 Oct: "blocks and ask IT / HR, so it mail id is
-- it_support@cyrix.in, so we need to create a admin login for it, id is
-- IT_ADMIN, only login tab and that too they can only edit mail field".
--
-- The IT_ADMIN record is made here, with no login: SW_ADMIN creates it
-- from its record ("Create their login"), and IT then sets their own
-- password with Forgot password — the code goes to it_support@cyrix.in.
-- IT reads the employee list and the login list; it writes one thing, an
-- official email, through it_set_work_email.
-- =====================================================================

alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role = any (array['hr_admin', 'super_admin', 'sw_admin', 'it_admin']));

create or replace function public.is_it_admin()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from user_roles where employee_id = current_employee_id() and role = 'it_admin')
$f$;
revoke execute on function public.is_it_admin() from public, anon;
grant execute on function public.is_it_admin() to authenticated;

insert into public.employees (ecode, full_name, designation, department, work_email, is_active, must_change_password)
values ('IT_ADMIN', 'IT Support', 'IT Administrator', 'IT', 'it_support@cyrix.in', true, true)
on conflict (ecode) do nothing;
insert into public.user_roles (employee_id, role)
select id, 'it_admin' from public.employees where ecode = 'IT_ADMIN'
on conflict do nothing;
-- KPI only (it is where the Logins tab lives); not the modules everybody else is given.
delete from public.employee_modules
 where employee_id = (select id from public.employees where ecode = 'IT_ADMIN') and module_code <> 'kpi';
insert into public.employee_modules (employee_id, module_code)
select id, 'kpi' from public.employees where ecode = 'IT_ADMIN'
on conflict do nothing;

-- IT reads who works here, to find the person whose email is missing.
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to public
  using ((auth_user_id = auth.uid()) or (reporting_manager_id = current_employee_id()) or (id = my_manager_id())
         or is_hr_admin() or is_sw_admin() or is_it_admin());

create or replace function public.login_status()
 returns setof v_login_status
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select * from v_login_status
  where is_sw_admin() or is_hr_admin() or is_it_admin()
$function$;

create or replace function public.it_set_work_email(p_ecode text, p_email text)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare
  e    employees%rowtype;
  mail text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_it_admin() or is_sw_admin() or is_hr_admin()) then
    raise exception 'Only IT, HR or the software administrator can change an email';
  end if;
  select * into e from employees where upper(ecode) = upper(btrim(coalesce(p_ecode, '')));
  if not found then raise exception 'There is nobody with the code %', p_ecode; end if;
  if mail <> '' and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not an email address';
  end if;
  update employees set work_email = nullif(mail, ''), updated_at = now() where id = e.id;
  perform log_audit('employee', e.id, 'work_email_changed',
                    jsonb_build_object('from', e.work_email, 'to', nullif(mail, '')));
  return nullif(mail, '');
end $f$;
revoke execute on function public.it_set_work_email(text, text) from public, anon;
grant execute on function public.it_set_work_email(text, text) to authenticated;
