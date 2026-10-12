-- =====================================================================
-- Cyrix KPI  ·  0172  ·  CYRA: say when a work email is shared
--
-- CYRA adopts an existing CYRA account whose email is the employee's work
-- email (the user, 12 Oct: "mail id is the login, so match it with our emp
-- db and get ecode"). Some work emails sit on more than one active
-- employee — one person's several logins, or two people on one mailbox —
-- and adopting by such an email would put two people into one CYRA
-- account. cyra_whoami() now says so, and CYRA then makes an account named
-- by the ecode instead.
-- =====================================================================

drop function if exists cyra_whoami();
create function cyra_whoami()
returns table (
  id uuid, ecode text, full_name text, work_email text, department text,
  function_name text, designation text, grade text, location text,
  is_active boolean, password_is_default boolean, has_module boolean,
  email_shared boolean
)
language sql security definer stable
set search_path = public
as $$
  -- The caller's own row only.
  select e.id, e.ecode, e.full_name, e.work_email, e.department,
         e.function_name, e.designation, e.grade, e.location,
         e.is_active, e.password_is_default,
         exists (select 1 from employee_modules m
                 join app_modules a on a.code = m.module_code and a.is_active
                 where m.employee_id = e.id and m.module_code = 'cyra'),
         exists (select 1 from employees o
                 where o.id <> e.id and o.is_active
                   and lower(btrim(o.work_email)) = lower(btrim(e.work_email)))
  from employees e
  where e.auth_user_id = auth.uid()
$$;

revoke all on function cyra_whoami() from public, anon;
grant execute on function cyra_whoami() to authenticated;
