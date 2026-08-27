-- =====================================================================
-- Cyrix KPI  ·  0053  ·  Testing the sender against a named employee
--
-- 0052 sent the test to the caller's own address and nowhere else, to
-- keep "send a test anywhere" off an admin screen — that is a way to
-- aim the company's mail reputation at any address you like.
--
-- Too tight, and in the one way that matters: SW_ADMIN has no address on
-- its own record, so the button could never work for the account it was
-- built for. It is also the wrong test. What SW Admin actually needs to
-- know is "would a code reach E1427", and the only way to answer that is
-- to send one to E1427.
--
-- So a target is allowed, and the property that mattered is kept: the
-- target is an EMPLOYEE CODE, never an address. The address comes from
-- that person's record, so this can only ever mail somebody the company
-- already mails, and an SW Admin who wants to send to an address of
-- their choosing has to put it on an employee record first — where it is
-- visible, audited, and somebody else's to notice.
-- =====================================================================

-- The parameter list changes shape, so the old one goes.
drop function if exists otp_test_recipient(text);

create or replace function otp_test_recipient(
  p_caller text,
  p_target text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  is_sw  boolean;
  target text := nullif(trim(coalesce(p_target, '')), '');
  emp    employees%rowtype;
begin
  -- The caller must be SW Admin. Checked from the ecode the edge
  -- function resolved out of their token, not from anything typed.
  select exists (
    select 1 from employees e
    join user_roles ur on ur.employee_id = e.id
    where upper(e.ecode) = upper(trim(p_caller))
      and e.is_active
      and ur.role in ('sw_admin', 'super_admin')
  ) into is_sw;

  if not is_sw then
    return jsonb_build_object('ok', false, 'reason', 'not_sw_admin');
  end if;

  -- No target named means "me", which is what 0052 always did.
  select * into emp from employees
  where upper(ecode) = upper(coalesce(target, trim(p_caller)))
    and is_active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_employee');
  end if;
  if emp.work_email is null or trim(emp.work_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email_on_record',
                              'ecode', emp.ecode, 'name', emp.full_name);
  end if;

  -- A real message to a real colleague, at somebody else's instigation.
  -- Worth a line in the log whether or not it ever matters.
  perform log_audit('employee', emp.id, 'otp_test_sent',
                    jsonb_build_object('by', upper(trim(p_caller))));

  return jsonb_build_object(
    'ok', true,
    'email', lower(trim(emp.work_email)),
    'name', emp.full_name,
    'ecode', emp.ecode);
end $$;

revoke execute on function otp_test_recipient(text, text) from public, anon, authenticated;
grant  execute on function otp_test_recipient(text, text) to service_role;

comment on function otp_test_recipient(text, text) is
  'Resolves who a sender test goes to. The caller must be SW Admin, and '
  'the target is an employee code rather than an address — so this can '
  'only reach somebody the company already has on file.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  sw_id     uuid;
  other_id  uuid;
  nomail_id uuid;
  r         jsonb;
begin
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0053-SW', 'Probe Admin', 'admin.probe@cyrix.in', true) returning id into sw_id;
  insert into user_roles (employee_id, role) values (sw_id, 'sw_admin');

  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0053-TM', 'Probe Member', 'member.probe@cyrix.in', true) returning id into other_id;

  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0053-NOMAIL', 'Probe Nomail', null, true) returning id into nomail_id;

  -- Somebody who is not SW Admin cannot send anything, to anyone.
  r := otp_test_recipient('ZZ-0053-TM', 'ZZ-0053-TM');
  if (r->>'ok')::boolean then raise exception 'A non-admin sent a test'; end if;
  if r->>'reason' <> 'not_sw_admin' then
    raise exception 'Non-admin gave reason %', r->>'reason';
  end if;

  -- No target still means "me", as it did before.
  r := otp_test_recipient('ZZ-0053-SW');
  if not (r->>'ok')::boolean then raise exception 'A blank target failed: %', r->>'reason'; end if;
  if r->>'email' <> 'admin.probe@cyrix.in' then
    raise exception 'A blank target went to %', r->>'email';
  end if;
  r := otp_test_recipient('ZZ-0053-SW', '   ');
  if r->>'email' <> 'admin.probe@cyrix.in' then
    raise exception 'Whitespace was not treated as blank';
  end if;

  -- A named colleague, which is the point of this migration.
  r := otp_test_recipient('ZZ-0053-SW', 'zz-0053-tm');
  if not (r->>'ok')::boolean then raise exception 'A named target failed: %', r->>'reason'; end if;
  if r->>'email' <> 'member.probe@cyrix.in' then
    raise exception 'A named target went to %', r->>'email';
  end if;

  -- Somebody real with no address, told apart from somebody who is not real.
  r := otp_test_recipient('ZZ-0053-SW', 'ZZ-0053-NOMAIL');
  if (r->>'ok')::boolean then raise exception 'A test was addressed to nobody'; end if;
  if r->>'reason' <> 'no_email_on_record' then
    raise exception 'No address gave reason %', r->>'reason';
  end if;
  if r->>'name' <> 'Probe Nomail' then
    raise exception 'The no-address answer should name who it is about';
  end if;

  r := otp_test_recipient('ZZ-0053-SW', 'ZZ-NOBODY-AT-ALL');
  if (r->>'ok')::boolean then raise exception 'A test found a nonexistent employee'; end if;
  if r->>'reason' <> 'no_such_employee' then
    raise exception 'A missing employee gave reason %', r->>'reason';
  end if;

  -- The thing that must stay true: a target is an employee code, so an
  -- address that belongs to nobody cannot be reached however it is typed.
  r := otp_test_recipient('ZZ-0053-SW', 'someone@example.com');
  if (r->>'ok')::boolean then
    raise exception 'A raw address was accepted as a target';
  end if;

  -- And the send is on the record.
  if not exists (
    select 1 from audit_log
    where action = 'otp_test_sent' and entity_id = other_id
  ) then
    raise exception 'A test send was not logged';
  end if;

  delete from audit_log where action = 'otp_test_sent'
    and entity_id in (sw_id, other_id, nomail_id);
  delete from user_roles where employee_id = sw_id;
  delete from employees where id in (sw_id, other_id, nomail_id);

  raise notice '0053 self-test passed (SW Admin only, employee codes only, and it is logged)';
end $$;
