-- =====================================================================
-- Cyrix KPI  ·  0008  ·  Fix infinite recursion in the employees policy
--
-- 0006 wrote employees_read with an inline subquery:
--
--   or id = (select reporting_manager_id from employees me
--            where me.auth_user_id = auth.uid())
--
-- That selects FROM employees inside a policy ON employees, so evaluating
-- the policy re-evaluates the policy:
--
--   ERROR 42P17: infinite recursion detected in policy for relation "employees"
--
-- The other three branches were fine because current_employee_id(),
-- manages_employee() and is_hr_admin() are SECURITY DEFINER and therefore
-- run as the owner, bypassing RLS. The subquery had no such escape.
--
-- Fix: move it into a SECURITY DEFINER function like the others.
-- =====================================================================

create or replace function my_manager_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select reporting_manager_id
  from employees
  where auth_user_id = auth.uid()
$$;

comment on function my_manager_id() is
  'The caller''s reporting manager. SECURITY DEFINER so it can be used inside '
  'an RLS policy on employees without recursing.';

drop policy if exists employees_read on employees;
create policy employees_read on employees for select to authenticated
using (
  auth_user_id = auth.uid()                        -- myself
  or reporting_manager_id = current_employee_id()  -- my direct reports
  or id = my_manager_id()                          -- my own manager
  or is_hr_admin()                                 -- HR sees everyone
);

grant execute on function my_manager_id() to authenticated;
