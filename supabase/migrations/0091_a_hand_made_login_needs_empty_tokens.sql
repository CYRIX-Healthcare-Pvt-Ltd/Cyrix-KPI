-- =====================================================================
-- Cyrix KPI  ·  0091  ·  A hand-made login needs empty tokens, not NULL
--
-- 0090 created the auth.users row and the account still could not sign
-- in. GoTrue answered "Database error querying schema", which sounds
-- like a broken database and is not: it scans the token columns into Go
-- strings that cannot hold NULL, so a row where they are NULL fails
-- while it is being read, before the password is ever considered.
--
-- Supabase's own sign-up path writes '' into every one of them. A row
-- inserted by hand gets NULL unless it says otherwise, and the eight
-- columns have no default. So the account looked perfect in SQL --
-- confirmed, not banned, identity present, password matching -- and was
-- unusable.
--
-- The eight are exactly the ones an existing working account has as ''.
-- phone stays NULL, which is what a working account has too.
--
-- Worth stating plainly for the next person: verifying an account by
-- reading its row is not the same as verifying it can sign in. The row
-- was right and the login was broken.
-- =====================================================================

/**
 * Repair anything 0090 already made.
 *
 * Scoped to rows that are actually wrong rather than to a date or a
 * list, so it fixes whatever exists and does nothing to accounts that
 * were fine.
 */
update auth.users
set confirmation_token         = coalesce(confirmation_token, ''),
    recovery_token             = coalesce(recovery_token, ''),
    email_change               = coalesce(email_change, ''),
    email_change_token_new     = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change               = coalesce(phone_change, ''),
    phone_change_token         = coalesce(phone_change_token, ''),
    reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;


-- ---------------------------------------------------------------------
-- And the function that made them, so the next one is right.
-- ---------------------------------------------------------------------
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

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    -- Empty, never NULL. GoTrue reads these into strings that cannot
    -- hold NULL and fails the whole lookup if they do -- which is what
    -- "Database error querying schema" means at a sign-in screen.
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    new_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', new_email,
    extensions.crypt(code, extensions.gen_salt('bf', 10)),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    '', '', '', '', '', '', '', ''
  );

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

revoke all on function public.hr_create_login(text) from public, anon;
grant execute on function public.hr_create_login(text) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Checks the thing that actually broke: every column GoTrue reads as a
-- string is a string. Comparing against a working account rather than
-- against a list, so a future GoTrue that adds a ninth column is caught
-- by the same test instead of needing it added here.
-- ---------------------------------------------------------------------
do $$
declare
  hr_u uuid; emp_id uuid; uid uuid; bad text;
begin
  select e.auth_user_id into hr_u
  from employees e join user_roles ur on ur.employee_id = e.id
  where ur.role in ('hr_admin', 'super_admin') and e.auth_user_id is not null and e.is_active
  limit 1;
  if hr_u is null then
    raise notice '0091 self-test skipped (no HR admin with a login)';
    return;
  end if;

  insert into employees (ecode, full_name, is_active)
  values ('ZZ0091', 'Probe', true) returning id into emp_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_u, 'role', 'authenticated')::text, true);
  perform hr_create_login('ZZ0091');
  select auth_user_id into uid from employees where id = emp_id;

  -- Any text column that is NULL on the new account while a working
  -- account has a value for it.
  select string_agg(c.column_name, ', ') into bad
  from information_schema.columns c
  where c.table_schema = 'auth' and c.table_name = 'users'
    and c.data_type in ('text', 'character varying')
    and c.column_name <> 'phone'
    and (select to_jsonb(u) ->> c.column_name from auth.users u where u.id = uid) is null
    and (select to_jsonb(u) ->> c.column_name from auth.users u where u.id = hr_u) is not null;

  if bad is not null then
    raise exception 'A new login has NULL where a working one has a value: %', bad;
  end if;

  -- Nothing was broken on the way past.
  if (select count(*) from auth.identities where user_id = uid) <> 1 then
    raise exception 'The identity row is missing';
  end if;

  raise notice '0091 self-test passed (a new login matches a working one field for field)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
