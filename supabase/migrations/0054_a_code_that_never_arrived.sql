-- =====================================================================
-- Cyrix KPI  ·  0054  ·  A code that never arrived should not count
--
-- Three attempts at a password change, three "Something went wrong
-- sending that", and then: "Too many codes requested. Try again in 15
-- minutes." Not one of those three codes reached an inbox.
--
-- issue_password_otp writes the row, and the edge function emails it
-- afterwards. When the mail provider refuses — an unverified domain, a
-- missing key, an outage at their end — the row is already there and
-- counts towards the three-per-quarter-hour limit. So a person is locked
-- out of a recovery flow by the recovery flow failing, which is the one
-- moment they can least afford it.
--
-- The rate limit is still right. It exists so somebody cannot spray a
-- colleague's inbox with codes, and that only means anything if a code
-- was actually sent. So this un-issues one that was not.
-- =====================================================================

create or replace function void_password_otp(p_ecode text, p_purpose text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  emp_id  uuid;
  otp_id  uuid;
begin
  select id into emp_id from employees
  where upper(ecode) = upper(trim(p_ecode)) and is_active;
  if emp_id is null then return false; end if;

  -- The newest unspent one, which is the one just written. Deleted
  -- rather than consumed: a consumed row still counts in the window,
  -- and the whole point is that this attempt never happened.
  select id into otp_id from password_otp
  where employee_id = emp_id and purpose = p_purpose and consumed_at is null
  order by created_at desc limit 1;

  if otp_id is null then return false; end if;

  delete from password_otp where id = otp_id;

  perform log_audit('employee', emp_id, 'password_otp_unsent',
                    jsonb_build_object('purpose', p_purpose));
  return true;
end $$;

revoke execute on function void_password_otp(text, text) from public, anon, authenticated;
grant  execute on function void_password_otp(text, text) to service_role;

comment on function void_password_otp(text, text) is
  'Undoes an issued code that could not be emailed, so a failure at the '
  'mail provider does not spend one of the caller''s three attempts.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  r      jsonb;
  n      integer;
begin
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0054-PROBE', 'Probe', 'probe@cyrix.in', true) returning id into emp_id;

  -- Three failed sends in a row must leave somebody able to try again,
  -- which is the entire bug.
  for i in 1..3 loop
    r := issue_password_otp('ZZ-0054-PROBE', 'probe@cyrix.in', 'change', '111111');
    if not (r->>'ok')::boolean then
      raise exception 'Attempt % was refused after % failed send(s): %', i, i - 1, r->>'reason';
    end if;
    -- ...and the mail provider refuses.
    if not void_password_otp('ZZ-0054-PROBE', 'change') then
      raise exception 'Attempt % could not be un-issued', i;
    end if;
  end loop;

  select count(*) into n from password_otp where employee_id = emp_id;
  if n <> 0 then raise exception 'Un-issued codes are still on file: %', n; end if;

  -- A fourth still works, where before this it would have been refused.
  r := issue_password_otp('ZZ-0054-PROBE', 'probe@cyrix.in', 'change', '222222');
  if not (r->>'ok')::boolean then
    raise exception 'Still locked out after three failed sends: %', r->>'reason';
  end if;

  -- But a code that DID send is untouched: the limit has to keep
  -- working, or somebody can spray a colleague's inbox.
  perform issue_password_otp('ZZ-0054-PROBE', 'probe@cyrix.in', 'reset', '333333');
  perform issue_password_otp('ZZ-0054-PROBE', 'probe@cyrix.in', 'reset', '444444');
  r := issue_password_otp('ZZ-0054-PROBE', 'probe@cyrix.in', 'reset', '555555');
  if (r->>'ok')::boolean then
    raise exception 'A fourth sent code was allowed through the limit';
  end if;

  -- Voiding takes the newest, and only one.
  select count(*) into n from password_otp where employee_id = emp_id;
  perform void_password_otp('ZZ-0054-PROBE', 'reset');
  if (select count(*) from password_otp where employee_id = emp_id) <> n - 1 then
    raise exception 'Voiding removed the wrong number of codes';
  end if;

  -- Nothing to void is not an error.
  delete from password_otp where employee_id = emp_id;
  if void_password_otp('ZZ-0054-PROBE', 'reset') then
    raise exception 'Voiding claimed to remove a code that did not exist';
  end if;
  if void_password_otp('ZZ-NOBODY', 'reset') then
    raise exception 'Voiding worked for an employee who does not exist';
  end if;

  delete from audit_log where action = 'password_otp_unsent' and entity_id = emp_id;
  delete from employees where id = emp_id;
  raise notice '0054 self-test passed (a code that never sent costs nobody an attempt)';
end $$;


-- ---------------------------------------------------------------------
-- And the three real ones that never arrived, on the way past.
--
-- Every code in the table at the time of writing was issued against an
-- unverified sending domain and refused by the provider. Leaving them
-- would keep somebody locked out for fifteen minutes over mail that
-- does not exist.
-- ---------------------------------------------------------------------
delete from password_otp where created_at < now();
