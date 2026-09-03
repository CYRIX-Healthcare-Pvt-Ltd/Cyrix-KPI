-- =====================================================================
-- Cyrix KPI  ·  0086  ·  Changing somebody's employee code
--
-- 78 people are on CT codes and move to E codes when they go permanent.
-- Until now there was no way to do it: the code is on the employee row,
-- and editing it there would have quietly locked the person out, because
-- the login is derived from it. E1042 signs in as e1042@cyrix.local, so
-- a code changed in one place and not the other is an account nobody can
-- reach and a password reset that goes to a person who no longer exists.
--
-- Three places have to move together, which is the whole reason this is
-- a function rather than an update statement:
--
--   employees.ecode          what every screen shows
--   auth.users.email         what the sign-in form is checked against
--   auth.identities          GoTrue's own copy of the same address
--
-- What deliberately does NOT move: the password, the person's id, and
-- therefore every submission, score, assignment and audit row hanging
-- off it. The id is the foreign key everywhere -- the code is a label,
-- and renaming a label should not disturb a year of history.
--
-- The new code is stated, never derived. CT679 does not become E679:
-- twenty-nine of the current CT codes already have an E code of the same
-- number belonging to somebody else, so a rule that computed the new
-- code would silently merge two people's records.
-- =====================================================================
create or replace function public.change_ecode(p_from text, p_to text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  emp        employees;
  clash      text;
  old_code   text := upper(btrim(coalesce(p_from, '')));
  new_code   text := upper(btrim(coalesce(p_to, '')));
  domain     text;
  new_email  text;
begin
  if not is_hr_admin() then
    raise exception 'Only HR can change an employee code';
  end if;

  if old_code = '' or new_code = '' then
    return jsonb_build_object('status', 'skipped', 'detail', 'Both codes are required');
  end if;
  if old_code = new_code then
    return jsonb_build_object('status', 'skipped', 'detail', 'That is already their code');
  end if;

  -- A code goes on badges, into spreadsheets and into an email address.
  -- Letters, digits and the odd separator; nothing that would need
  -- escaping in any of those places.
  if new_code !~ '^[A-Z0-9][A-Z0-9._-]*$' then
    return jsonb_build_object(
      'status', 'skipped',
      'detail', format('%s is not a usable employee code', new_code));
  end if;

  select * into emp from employees where upper(btrim(ecode)) = old_code;
  if emp.id is null then
    return jsonb_build_object('status', 'skipped', 'detail', 'No employee with that code');
  end if;

  -- Taken, and by somebody else. Named in the answer: "already in use"
  -- sends HR to look for a row they cannot find, and the whole point of
  -- stating the new code is that a human is choosing it.
  select full_name into clash from employees
  where upper(btrim(ecode)) = new_code and id <> emp.id;
  if clash is not null then
    return jsonb_build_object(
      'status', 'skipped',
      'detail', format('%s already belongs to %s', new_code, clash));
  end if;

  update employees set ecode = new_code, updated_at = now() where id = emp.id;

  -- The login, if they have one. Somebody on the payroll with no account
  -- yet is a normal state -- their code changes and there is nothing to
  -- move.
  if emp.auth_user_id is not null then
    select split_part(email, '@', 2) into domain
    from auth.users where id = emp.auth_user_id;

    if coalesce(domain, '') = '' then
      raise exception 'Cannot work out the login domain for %', old_code;
    end if;
    new_email := lower(new_code) || '@' || domain;

    if exists (
      select 1 from auth.users
      where lower(email) = new_email and id <> emp.auth_user_id
    ) then
      return jsonb_build_object(
        'status', 'skipped',
        'detail', format('A login for %s already exists', new_email));
    end if;

    update auth.users
    set email = new_email, updated_at = now()
    where id = emp.auth_user_id;

    -- GoTrue keeps its own copy on the identity row. Left behind, the
    -- two disagree about who this account belongs to.
    update auth.identities
    set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(new_email)),
        updated_at = now()
    where user_id = emp.auth_user_id and provider = 'email';
  end if;

  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (current_employee_id(), 'employee', emp.id, 'ecode_changed',
          jsonb_build_object('from', old_code, 'to', new_code,
                             'name', emp.full_name,
                             'login_moved', emp.auth_user_id is not null));

  return jsonb_build_object(
    'status', 'changed',
    'detail', format('%s is now %s', old_code, new_code),
    'employee', emp.full_name);
end $function$;

revoke all on function public.change_ecode(text, text) from public, anon;
grant execute on function public.change_ecode(text, text) to authenticated;

comment on function public.change_ecode(text, text) is
  'Renames an employee code and moves the login with it. HR only. The '
  'password and every record keyed on the employee id are untouched.';

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Runs as HR, on a probe employee with a real login, and rolls the whole
-- thing back. The login half is the half worth proving: an employee row
-- that renames while the account does not is somebody locked out.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id  uuid;
  usr_id  uuid := gen_random_uuid();
  hr_e    uuid;
  hr_u    uuid;
  res     jsonb;
  got     text;
  other   uuid;
begin
  select e.id, e.auth_user_id into hr_e, hr_u
  from employees e join user_roles ur on ur.employee_id = e.id
  where ur.role in ('hr_admin', 'super_admin')
    and e.auth_user_id is not null and e.is_active
  limit 1;
  if hr_e is null then
    raise notice '0086 self-test skipped (no HR admin with a login to run as)';
    return;
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (usr_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz0086probe@cyrix.local', 'x', now(), now());
  insert into auth.identities (id, user_id, provider, provider_id, identity_data,
                               created_at, updated_at)
  values (gen_random_uuid(), usr_id, 'email', usr_id::text,
          jsonb_build_object('sub', usr_id::text, 'email', 'zz0086probe@cyrix.local'),
          now(), now());

  insert into employees (ecode, full_name, is_active, auth_user_id)
  values ('ZZ0086PROBE', 'Probe', true, usr_id) returning id into emp_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', hr_u, 'role', 'authenticated')::text, true);

  -- The ordinary case: the code moves and the login moves with it.
  res := change_ecode('ZZ0086PROBE', 'ZZ0086DONE');
  if res->>'status' <> 'changed' then
    raise exception 'Expected changed, got % (%)', res->>'status', res->>'detail';
  end if;

  select ecode into got from employees where id = emp_id;
  if got <> 'ZZ0086DONE' then raise exception 'The code did not change: %', got; end if;

  select email into got from auth.users where id = usr_id;
  if got <> 'zz0086done@cyrix.local' then
    raise exception 'The login did not move with the code: %', got;
  end if;

  select identity_data->>'email' into got from auth.identities where user_id = usr_id;
  if got <> 'zz0086done@cyrix.local' then
    raise exception 'The identity still carries the old address: %', got;
  end if;

  -- The id is untouched, which is what keeps a year of history attached.
  if (select auth_user_id from employees where id = emp_id) <> usr_id then
    raise exception 'The account was re-pointed rather than renamed';
  end if;

  -- A code somebody else holds is refused, and says who holds it.
  insert into employees (ecode, full_name, is_active)
  values ('ZZ0086TAKEN', 'Holder', true) returning id into other;
  res := change_ecode('ZZ0086DONE', 'ZZ0086TAKEN');
  if res->>'status' <> 'skipped' or res->>'detail' not like '%Holder%' then
    raise exception 'A code in use was accepted: %', res;
  end if;
  if (select ecode from employees where id = emp_id) <> 'ZZ0086DONE' then
    raise exception 'A refused change was applied anyway';
  end if;

  -- Nonsense codes, no-ops and unknown people all answer rather than throw.
  if (change_ecode('ZZ0086DONE', 'has space')->>'status') <> 'skipped' then
    raise exception 'A code with a space was accepted';
  end if;
  if (change_ecode('ZZ0086DONE', 'ZZ0086DONE')->>'status') <> 'skipped' then
    raise exception 'Renaming to the same code was not a no-op';
  end if;
  if (change_ecode('NOBODY-AT-ALL', 'ZZ0086NEW')->>'status') <> 'skipped' then
    raise exception 'An unknown code was not skipped';
  end if;

  -- And nobody but HR may do any of it.
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform change_ecode('ZZ0086DONE', 'ZZ0086SNEAK');
    raise exception 'A non-HR caller could rename somebody';
  exception when others then
    if sqlerrm not like '%Only HR%' then raise; end if;
  end;

  raise notice '0086 self-test passed (code and login move together, collisions refused)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
