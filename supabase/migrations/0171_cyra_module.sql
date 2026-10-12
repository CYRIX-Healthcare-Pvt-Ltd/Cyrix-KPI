-- =====================================================================
-- Cyrix KPI  ·  0171  ·  CYRA on the portal
--
-- The user, 12 Oct: "need to add this in our module", "login also only
-- our portal … mail id is the login, so match it with our emp db and get
-- ecode", "when creating new user ecode will be the user name".
--
-- CYRA (repo Cyrix-Cyra, its own Supabase project) is opened from a portal
-- tile. The portal hands CYRA the employee's access token; CYRA's engine
-- checks it and calls cyra_whoami() here to learn who this is — ecode (its
-- username for a new account), work email (to adopt an existing CYRA
-- account), and whether they hold the cyra module. No password ever
-- reaches CYRA.
--
-- Granted to the test accounts only. The pilot (E1337 and the Expert Link
-- function) is granted once CYRA's sign-in from the portal is live, so
-- nobody sees a tile that leads nowhere.
-- =====================================================================

insert into app_modules (code, name, description, path, icon, sort_order)
values ('cyra', 'CYRA', 'Field-service knowledge: guidance on the job and what was done.', '/cyra', 'Stethoscope', 80)
on conflict (code) do nothing;

insert into employee_modules (employee_id, module_code)
select id, 'cyra' from employees where ecode in ('E8888', 'E9999')
on conflict do nothing;

create or replace function cyra_whoami()
returns table (
  id uuid, ecode text, full_name text, work_email text, department text,
  function_name text, designation text, grade text, location text,
  is_active boolean, password_is_default boolean, has_module boolean
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
                 where m.employee_id = e.id and m.module_code = 'cyra')
  from employees e
  where e.auth_user_id = auth.uid()
$$;

revoke all on function cyra_whoami() from public, anon;
grant execute on function cyra_whoami() to authenticated;
