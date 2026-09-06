-- =====================================================================
-- Cyrix KPI  ·  0105  ·  The two admin logins can set their own address
--
-- Management: HR Admin and SW Admin can enter their own official email
-- on their profile. Nobody else can, and neither can set anybody else's.
--
-- HR_ADMIN and SW_ADMIN are shared logins rather than people, so the HR
-- import never gave either one a work_email and nothing in the app could
-- add one. That field is what ChangePassword reads to decide whether a
-- password change needs an emailed code, so today the two most
-- privileged accounts in the system change their password with no second
-- step at all -- and had no way to fix that from inside the app.
--
-- Deliberately not self-service for everybody else. For the other 1,148
-- people the address is a fact HR maintains on the record, and letting
-- somebody point their own recovery mail wherever they like turns a
-- field HR owns into one that anybody with a borrowed session owns.
--
-- The @cyrix.in rule is enforced here as well as in the field, because
-- lib/officialEmail.ts says plainly that it is not a security control --
-- it is there so somebody typing a personal address finds out while
-- looking at the box. A write has to be checked where it lands.
-- =====================================================================

create or replace function set_my_work_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_email text := nullif(btrim(lower(p_email)), '');
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR Admin and SW Admin can set their own work email';
  end if;

  v_id := current_employee_id();
  if v_id is null then
    raise exception 'There is no employee record behind this login';
  end if;

  -- The domain must EQUAL cyrix.in rather than merely end with it, for
  -- the reason officialEmail.ts gives: notcyrix.in ends with it too.
  if v_email is not null
     and v_email !~ '^[^@[:space:]<>,]+@cyrix[.]in$' then
    raise exception 'Use an official @cyrix.in email, not a personal one';
  end if;

  -- Their own row, by construction. There is no argument for whose.
  update employees set work_email = v_email where id = v_id;
end;
$$;

revoke all on function set_my_work_email(text) from public;
grant execute on function set_my_work_email(text) to authenticated;

comment on function set_my_work_email(text) is
  'HR Admin / SW Admin set their own official address. See 0105.';

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  sw_auth   uuid;
  emp_auth  uuid;
  sw_id     uuid;
  refused   boolean;
  got       text;
begin
  select auth_user_id, id into sw_auth, sw_id
  from employees where ecode = 'SW_ADMIN';
  select auth_user_id into emp_auth
  from employees where ecode = 'E8888';

  if sw_auth is null or emp_auth is null then
    raise notice '0105 self-test skipped (SW_ADMIN or E8888 has no login)';
    return;
  end if;

  -- 1. An ordinary employee is refused.
  perform set_config('request.jwt.claims',
    json_build_object('sub', emp_auth, 'role', 'authenticated')::text, true);
  refused := false;
  begin
    perform set_my_work_email('someone@cyrix.in');
  exception when others then
    if sqlerrm like '%Only HR Admin and SW Admin%' then refused := true; else raise; end if;
  end;
  if not refused then
    raise exception 'an ordinary employee set a work email';
  end if;

  -- 2. SW Admin is refused a personal address, and a lookalike domain.
  perform set_config('request.jwt.claims',
    json_build_object('sub', sw_auth, 'role', 'authenticated')::text, true);
  foreach got in array array['someone@gmail.com', 'someone@notcyrix.in', 'nodomain']
  loop
    refused := false;
    begin
      perform set_my_work_email(got);
    exception when others then
      if sqlerrm like '%official @cyrix.in%' then refused := true; else raise; end if;
    end;
    if not refused then
      raise exception 'accepted a bad address: %', got;
    end if;
  end loop;

  -- 3. SW Admin sets their own, and it lands on their own row.
  perform set_my_work_email('  SW.Admin@Cyrix.IN  ');
  select work_email into got from employees where id = sw_id;
  if got is distinct from 'sw.admin@cyrix.in' then
    raise exception 'expected the trimmed lowercase address, got %', got;
  end if;

  -- 4. Clearing it is allowed -- it is their own account to change back.
  perform set_my_work_email('');
  select work_email into got from employees where id = sw_id;
  if got is not null then
    raise exception 'expected null after clearing, got %', got;
  end if;

  raise notice '0105 self-test passed (refusals, domain rule, own row, clear)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
