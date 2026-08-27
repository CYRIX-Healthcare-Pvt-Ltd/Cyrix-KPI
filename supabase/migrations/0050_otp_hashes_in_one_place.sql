-- =====================================================================
-- Cyrix KPI  ·  0050  ·  One place that knows how a code is hashed
--
-- 0049 took a hash rather than a code, on the reasoning that the plain
-- code should stay with whoever is emailing it. That is the wrong trade.
--
-- It puts the hashing in the edge function and the checking in Postgres,
-- which means two runtimes and two bcrypt implementations have to agree
-- forever about a cost factor and a salt format. They will not. It also
-- drags a bcrypt library into Deno, where the pure-JS ones are slow
-- enough to matter on a function that is meant to answer in under a
-- second.
--
-- So the code itself is passed in and hashed here, beside the crypt()
-- that verifies it. It arrives over TLS on a connection that is already
-- carrying the employee code and the address, it is hashed before the
-- statement returns, and it is never stored, logged or returned.
--
-- check_password_otp is untouched -- it always took the plain code.
-- =====================================================================

-- The parameter changes meaning, and Postgres will not rename an input
-- parameter through CREATE OR REPLACE.
drop function if exists issue_password_otp(text, text, text, text);

create or replace function issue_password_otp(
  p_ecode   text,
  p_email   text,
  p_purpose text,
  p_code    text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  emp        employees%rowtype;
  recent     integer;
  ttl        constant interval := interval '10 minutes';
  window_    constant interval := interval '15 minutes';
  per_window constant integer  := 3;
begin
  -- Housekeeping, here rather than in a cron: a code is worthless the
  -- moment it expires and there is no reason to keep the hash.
  delete from password_otp where created_at < now() - interval '24 hours';

  select * into emp from employees
  where upper(ecode) = upper(trim(p_ecode)) and is_active;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_employee');
  end if;

  -- No address on file is not the same as a wrong address, and the two
  -- have to be told apart here even though the person is told the same
  -- thing either way. HR is the only route for somebody in this state.
  if emp.work_email is null or trim(emp.work_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email_on_record');
  end if;

  -- Typed by hand, on a phone, by somebody who is locked out. Case and
  -- stray spaces are not the test.
  if lower(trim(emp.work_email)) <> lower(trim(coalesce(p_email, ''))) then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;

  if coalesce(trim(p_code), '') = '' then
    raise exception 'issue_password_otp needs a code to hash';
  end if;

  select count(*) into recent from password_otp
  where employee_id = emp.id and created_at > now() - window_;

  if recent >= per_window then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Asking for a second code retires the first. Two live codes doubles
  -- the guessing surface and gives somebody two ways to be confused
  -- about which number to type.
  update password_otp set consumed_at = now()
  where employee_id = emp.id and purpose = p_purpose and consumed_at is null;

  insert into password_otp (employee_id, purpose, code_hash, sent_to, expires_at)
  values (emp.id, p_purpose, crypt(p_code, gen_salt('bf')),
          lower(trim(emp.work_email)), now() + ttl);

  perform log_audit('employee', emp.id, 'password_otp_issued',
                    jsonb_build_object('purpose', p_purpose));

  return jsonb_build_object(
    'ok', true,
    'employee_id', emp.id,
    'email', lower(trim(emp.work_email)),
    'name', emp.full_name,
    'expires_in_minutes', 10);
end $$;

revoke execute on function issue_password_otp(text, text, text, text) from public, anon, authenticated;
grant  execute on function issue_password_otp(text, text, text, text) to service_role;


-- ---------------------------------------------------------------------
-- Self-test.
--
-- 0049's suite again, because the whole issuing path was rewritten, plus
-- the thing this migration exists for: a code handed to issue_ verifies
-- against check_ without either of them being told how the other works.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  code   text := '739104';
  r      jsonb;
  stored text;
begin
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0050-PROBE', 'Probe', 'probe@cyrix.in', true)
  returning id into emp_id;

  r := issue_password_otp('ZZ-0050-PROBE', 'probe@cyrix.in', 'reset', code);
  if not (r->>'ok')::boolean then
    raise exception 'Issuing failed: %', r->>'reason';
  end if;

  -- The code is hashed, not kept.
  select code_hash into stored from password_otp
  where employee_id = emp_id and consumed_at is null;
  if stored = code then raise exception 'The code was stored in the clear'; end if;
  if stored not like '$2%' then
    raise exception 'Expected a bcrypt hash, got %', left(stored, 8);
  end if;

  -- The round trip this migration exists for.
  r := check_password_otp('ZZ-0050-PROBE', code, 'reset');
  if not (r->>'ok')::boolean then
    raise exception 'A code from issue_ did not verify in check_: %', r->>'reason';
  end if;

  -- Everything 0049 proved, proved again against the new path.
  r := issue_password_otp('ZZ-0050-PROBE', 'wrong@cyrix.in', 'reset', code);
  if (r->>'ok')::boolean then raise exception 'A wrong address was accepted'; end if;

  perform issue_password_otp('ZZ-0050-PROBE', 'PROBE@CYRIX.IN ', 'reset', code);
  r := check_password_otp('ZZ-0050-PROBE', '000000', 'reset');
  if (r->>'ok')::boolean then raise exception 'A wrong code was accepted'; end if;
  if (r->>'attempts_left')::int <> 4 then
    raise exception 'Expected 4 attempts left, got %', r->>'attempts_left';
  end if;

  r := check_password_otp('ZZ-0050-PROBE', code, 'reset');
  if not (r->>'ok')::boolean then raise exception 'The right code was refused'; end if;
  r := check_password_otp('ZZ-0050-PROBE', code, 'reset');
  if (r->>'ok')::boolean then raise exception 'A code worked twice'; end if;

  -- Two codes in a row are genuinely different hashes: the salt is fresh
  -- each time, so an identical code does not produce an identical row.
  delete from password_otp where employee_id = emp_id;
  perform issue_password_otp('ZZ-0050-PROBE', 'probe@cyrix.in', 'change', code);
  select code_hash into stored from password_otp where employee_id = emp_id;
  perform issue_password_otp('ZZ-0050-PROBE', 'probe@cyrix.in', 'change', code);
  if exists (select 1 from password_otp
             where employee_id = emp_id and consumed_at is null and code_hash = stored) then
    raise exception 'The same code hashed to the same value twice';
  end if;

  -- An empty code is a bug in the caller, not something to store.
  begin
    perform issue_password_otp('ZZ-0050-PROBE', 'probe@cyrix.in', 'reset', '   ');
    raise exception 'An empty code was accepted';
  exception when others then
    if sqlerrm not like '%needs a code to hash%' then raise; end if;
  end;

  delete from employees where id = emp_id;
  raise notice '0050 self-test passed (issue and check agree, and only Postgres knows how)';
end $$;
