-- =====================================================================
-- Cyrix KPI  ·  0090  ·  A new employee can actually sign in
--
-- HR's "Add employee" wrote the employee row and stopped there. No
-- auth.users row, no identity, so auth_user_id stayed null and the
-- person had no account at all -- and the failure looks exactly like a
-- wrong password, because the sign-in form cannot tell "no such account"
-- from "wrong password" and must not. Somebody typing their employee
-- code as the password, correctly, is told it is wrong forever.
--
-- Logins were being made by scripts/user-admin.mjs, out of band, by
-- somebody with the service key. That is a fine way to seed 1,148 people
-- once and a poor way to add the 1,149th.
--
-- The browser cannot do it: creating an auth user needs privileges no
-- anon or authenticated role has. So it happens here, the same way
-- reset_all_passwords_to_ecode already writes to auth.users.
--
-- The password is the employee code, which is the convention the rest of
-- the app already states out loud -- SW Admin's reset does exactly this,
-- and the manual says so. must_change_password follows the same setting
-- that reset honours, so a company that forces a change on first use
-- gets one here too.
-- =====================================================================
create or replace function public.hr_create_login(p_ecode text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  emp          employees;
  code         text := upper(btrim(coalesce(p_ecode, '')));
  domain       text := coalesce(
                 nullif(current_setting('app.auth_domain', true), ''), 'cyrix.local');
  new_email    text;
  new_id       uuid := gen_random_uuid();
  force_change boolean;
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR or the software administrator can create a login';
  end if;

  select * into emp from employees where upper(btrim(ecode)) = code;
  if emp.id is null then
    raise exception 'No employee with code %', code;
  end if;
  if emp.auth_user_id is not null then
    return jsonb_build_object('ok', false, 'detail', 'They already have a login');
  end if;

  new_email := lower(code) || '@' || domain;
  if exists (select 1 from auth.users where lower(email) = new_email) then
    raise exception 'A login for % already exists but is not linked to anybody', new_email;
  end if;

  -- email_confirmed_at is set: these addresses are internal and nobody
  -- ever receives anything at them, so an unconfirmed account would be
  -- one that can never be confirmed.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    new_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', new_email,
    extensions.crypt(code, extensions.gen_salt('bf', 10)),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb
  );

  -- GoTrue keeps its own copy of the address on the identity row. Without
  -- this the account exists and the sign-in still fails.
  insert into auth.identities (
    id, user_id, provider, provider_id, identity_data, created_at, updated_at
  ) values (
    gen_random_uuid(), new_id, 'email', new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', new_email),
    now(), now()
  );

  select coalesce(value::text::boolean, false) into force_change
  from app_settings where key = 'force_password_change';

  update employees
  set auth_user_id = new_id,
      must_change_password = coalesce(force_change, false),
      updated_at = now()
  where id = emp.id;

  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (current_employee_id(), 'employee', emp.id, 'login_created',
          jsonb_build_object('ecode', code, 'email', new_email));

  return jsonb_build_object('ok', true, 'email', new_email);
end $$;


/**
 * Remove somebody who should never have been here.
 *
 * Deliberately narrow. A person with a KPI, a submission or a score is
 * part of the record and is deactivated, never deleted -- their months
 * are what their manager was judged on too. This is for the row typed by
 * mistake, and it refuses anything else and says which.
 */
create or replace function public.hr_delete_employee(p_ecode text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  emp   employees;
  code  text := upper(btrim(coalesce(p_ecode, '')));
  holds text;
begin
  if not is_hr_admin() then
    raise exception 'Only HR can delete an employee record';
  end if;

  select * into emp from employees where upper(btrim(ecode)) = code;
  if emp.id is null then
    raise exception 'No employee with code %', code;
  end if;
  if emp.id = current_employee_id() then
    raise exception 'You cannot delete your own record';
  end if;

  select string_agg(what, ', ') into holds from (
    select 'a KPI for the year' as what
      where exists (select 1 from kpi_assignments where employee_id = emp.id)
    union all
    select 'monthly assessments'
      where exists (select 1 from kpi_submissions where employee_id = emp.id)
    union all
    select 'people reporting to them'
      where exists (select 1 from employees where reporting_manager_id = emp.id and is_active)
  ) t;

  if holds is not null then
    return jsonb_build_object(
      'ok', false,
      'detail', format('%s has %s. Deactivate them instead — their record is part of '
                       'the year and their manager was measured on it too.',
                       emp.full_name, holds));
  end if;

  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (current_employee_id(), 'employee', emp.id, 'employee_deleted',
          jsonb_build_object('ecode', code, 'name', emp.full_name));

  -- The login goes with them. Left behind it is an account with nobody
  -- on the other side of it, holding the address their code would need.
  if emp.auth_user_id is not null then
    delete from auth.identities where user_id = emp.auth_user_id;
    delete from auth.users where id = emp.auth_user_id;
  end if;
  delete from employees where id = emp.id;

  return jsonb_build_object('ok', true, 'detail', format('%s removed', emp.full_name));
end $$;

revoke all on function public.hr_create_login(text)    from public, anon;
revoke all on function public.hr_delete_employee(text) from public, anon;
grant execute on function public.hr_create_login(text)    to authenticated;
grant execute on function public.hr_delete_employee(text) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  hr_u uuid; emp_id uuid; r jsonb; uid uuid;
begin
  select e.auth_user_id into hr_u
  from employees e join user_roles ur on ur.employee_id = e.id
  where ur.role in ('hr_admin', 'super_admin') and e.auth_user_id is not null and e.is_active
  limit 1;
  if hr_u is null then
    raise notice '0090 self-test skipped (no HR admin with a login)';
    return;
  end if;

  insert into employees (ecode, full_name, is_active)
  values ('ZZ0090', 'Probe', true) returning id into emp_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_u, 'role', 'authenticated')::text, true);

  -- A login is made, linked, and the password is the code.
  r := hr_create_login('ZZ0090');
  if not (r->>'ok')::boolean then raise exception 'No login made: %', r; end if;

  select auth_user_id into uid from employees where id = emp_id;
  if uid is null then raise exception 'The employee was not linked to the login'; end if;
  if (select email from auth.users where id = uid) <> 'zz0090@cyrix.local' then
    raise exception 'Wrong address on the login';
  end if;
  if (select identity_data->>'email' from auth.identities where user_id = uid)
     <> 'zz0090@cyrix.local' then
    raise exception 'The identity carries the wrong address';
  end if;
  if (select encrypted_password from auth.users where id = uid)
     <> extensions.crypt('ZZ0090', (select encrypted_password from auth.users where id = uid)) then
    raise exception 'The password is not the employee code';
  end if;

  -- Twice is a no-op rather than a second account.
  r := hr_create_login('ZZ0090');
  if (r->>'ok')::boolean then raise exception 'A second login was made'; end if;

  -- Deleting takes the login with it.
  r := hr_delete_employee('ZZ0090');
  if not (r->>'ok')::boolean then raise exception 'Could not delete a clean record: %', r; end if;
  if exists (select 1 from auth.users where id = uid) then
    raise exception 'The login outlived the employee';
  end if;

  -- Somebody with history is refused, by name.
  insert into employees (ecode, full_name, is_active)
  values ('ZZ0090B', 'Probe B', true) returning id into emp_id;
  insert into kpi_assignments (employee_id, financial_year, status,
                               job_role_weight, core_values_weight, esms_weight)
  values (emp_id, '2026-27', 'draft', 80, 20, 0);

  r := hr_delete_employee('ZZ0090B');
  if (r->>'ok')::boolean then raise exception 'Somebody with a KPI was deleted'; end if;
  if r->>'detail' not like '%KPI%' then raise exception 'The refusal does not say why: %', r; end if;

  raise notice '0090 self-test passed (a new employee gets a login; only a clean record deletes)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
