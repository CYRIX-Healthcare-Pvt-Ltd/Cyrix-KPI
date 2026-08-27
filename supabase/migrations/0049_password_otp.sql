-- =====================================================================
-- Cyrix KPI  ·  0049  ·  One-time codes for password changes
--
-- Today "Forgot password?" sets the account back to the employee code
-- itself, and the only thing you need to do that to somebody is know
-- their employee code. Every ecode in the company is printed on a badge.
-- The self_service_password_reset switch is the sole guard, which is why
-- it has to be off in production and why nobody can actually use the
-- feature.
--
-- So a code goes to the address on that person's record, and nothing
-- happens until it comes back. Same machinery for changing a password
-- while signed in, where it answers a different question: a service
-- floor shares phones, and an unlocked handset should not be enough to
-- take somebody's account.
--
-- What this file deliberately does NOT do:
--
--   generate the code   The database would then have to hand it back to
--                       whoever asked, and "whoever asked" is a browser.
--                       The edge function makes it, sends it, and tells
--                       us only its hash.
--   send anything       Postgres has no business holding a mail key.
--   answer the browser  Every function here is service_role only and
--                       tells the truth. Deciding what a stranger gets
--                       told is the edge function's job, and its answer
--                       is the same either way -- see the note on
--                       enumeration below.
-- =====================================================================

create table if not exists password_otp (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  purpose      text not null check (purpose in ('change','reset')),
  -- bcrypt, not the code. A six-digit number is small enough to brute
  -- force offline in seconds; what makes it safe is that it lives ten
  -- minutes and dies after five wrong guesses, and what makes a leaked
  -- backup harmless is this.
  code_hash    text not null,
  -- Where it actually went. The one thing worth being able to answer
  -- afterwards is "which address received the code for this account".
  sent_to      text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_password_otp_live
  on password_otp (employee_id, purpose, created_at desc);

alter table password_otp enable row level security;

-- No policies, on purpose. RLS with no policy denies everything, so the
-- anon and authenticated roles cannot read a hash, an address or even
-- the fact that a code was issued. The functions below are the only
-- doors, and they are service_role only.
comment on table password_otp is
  'One-time codes for password reset and change. No RLS policies by '
  'design: reachable only through the security-definer functions in '
  'this migration, which are granted to service_role alone.';


-- ---------------------------------------------------------------------
-- Issuing.
--
-- The caller has already generated the code and is about to email it.
-- All this does is decide whether it is allowed to, and remember the
-- hash if so.
-- ---------------------------------------------------------------------
create or replace function issue_password_otp(
  p_ecode     text,
  p_email     text,
  p_purpose   text,
  p_code_hash text
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
  values (emp.id, p_purpose, p_code_hash, lower(trim(emp.work_email)), now() + ttl);

  perform log_audit('employee', emp.id, 'password_otp_issued',
                    jsonb_build_object('purpose', p_purpose));

  return jsonb_build_object(
    'ok', true,
    'employee_id', emp.id,
    'email', lower(trim(emp.work_email)),
    'name', emp.full_name,
    'expires_in_minutes', 10);
end $$;


-- ---------------------------------------------------------------------
-- Checking.
--
-- Consumes the code on success, so it works exactly once even if two
-- requests arrive together.
-- ---------------------------------------------------------------------
create or replace function check_password_otp(
  p_ecode   text,
  p_code    text,
  p_purpose text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  emp      employees%rowtype;
  otp      password_otp%rowtype;
  max_try  constant integer := 5;
begin
  select * into emp from employees
  where upper(ecode) = upper(trim(p_ecode)) and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_employee');
  end if;

  -- Locked, because attempts is a counter two simultaneous guesses would
  -- otherwise both read as the same number.
  select * into otp from password_otp
  where employee_id = emp.id and purpose = p_purpose and consumed_at is null
  order by created_at desc limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_code_outstanding');
  end if;

  if otp.expires_at < now() then
    update password_otp set consumed_at = now() where id = otp.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if otp.attempts >= max_try then
    update password_otp set consumed_at = now() where id = otp.id;
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if otp.code_hash <> crypt(coalesce(p_code, ''), otp.code_hash) then
    update password_otp set attempts = attempts + 1 where id = otp.id;
    return jsonb_build_object(
      'ok', false, 'reason', 'wrong_code',
      'attempts_left', max_try - (otp.attempts + 1));
  end if;

  update password_otp set consumed_at = now() where id = otp.id;

  perform log_audit('employee', emp.id, 'password_otp_verified',
                    jsonb_build_object('purpose', p_purpose));

  return jsonb_build_object(
    'ok', true, 'employee_id', emp.id, 'auth_user_id', emp.auth_user_id);
end $$;


-- ---------------------------------------------------------------------
-- Who may call these.
--
-- Nobody with a browser. Both functions answer truthfully -- "no such
-- employee", "email_mismatch" -- and a truthful answer handed to a
-- stranger is a way to find out who works here and what their address
-- is. The edge function turns every one of those into the same sentence
-- before anybody sees it.
-- ---------------------------------------------------------------------
revoke execute on function issue_password_otp(text, text, text, text) from public, anon, authenticated;
revoke execute on function check_password_otp(text, text, text)       from public, anon, authenticated;
grant  execute on function issue_password_otp(text, text, text, text) to service_role;
grant  execute on function check_password_otp(text, text, text)       to service_role;


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Builds its own employee, runs a code through every way it can fail,
-- and deletes it again. Each file is one committing transaction, so the
-- cleanup at the end is the only thing standing between this and a
-- permanent ZZ-0049-PROBE in the org chart.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id   uuid;
  code     text := '482913';
  hash     text := crypt(code, gen_salt('bf'));
  r        jsonb;
  otp_id   uuid;
begin
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0049-PROBE', 'Probe', ' Probe@Cyrix.IN ', true)
  returning id into emp_id;

  -- Wrong address is refused, and the address on file is not echoed.
  r := issue_password_otp('ZZ-0049-PROBE', 'someone.else@cyrix.in', 'reset', hash);
  if (r->>'ok')::boolean then raise exception 'A wrong address was accepted'; end if;
  if r->>'reason' <> 'email_mismatch' then
    raise exception 'Wrong address gave reason %', r->>'reason';
  end if;

  -- Case and spaces are not the test. A locked-out person types this on
  -- a phone.
  r := issue_password_otp('zz-0049-probe', '  probe@cyrix.in ', 'reset', hash);
  if not (r->>'ok')::boolean then
    raise exception 'A correct address was refused: %', r->>'reason';
  end if;

  -- A wrong code counts against you and says how many are left.
  r := check_password_otp('ZZ-0049-PROBE', '000000', 'reset');
  if (r->>'ok')::boolean then raise exception 'A wrong code was accepted'; end if;
  if (r->>'attempts_left')::int <> 4 then
    raise exception 'Expected 4 attempts left, got %', r->>'attempts_left';
  end if;

  -- A code issued for one purpose is not a code for the other.
  r := check_password_otp('ZZ-0049-PROBE', code, 'change');
  if (r->>'ok')::boolean then
    raise exception 'A reset code worked as a change code';
  end if;

  -- The right one works.
  r := check_password_otp('ZZ-0049-PROBE', code, 'reset');
  if not (r->>'ok')::boolean then
    raise exception 'The correct code was refused: %', r->>'reason';
  end if;

  -- And works exactly once.
  r := check_password_otp('ZZ-0049-PROBE', code, 'reset');
  if (r->>'ok')::boolean then raise exception 'A code worked twice'; end if;
  if r->>'reason' <> 'no_code_outstanding' then
    raise exception 'Reuse gave reason %', r->>'reason';
  end if;

  -- Expiry.
  perform issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'reset', hash);
  update password_otp set expires_at = now() - interval '1 minute'
  where employee_id = emp_id and consumed_at is null;
  r := check_password_otp('ZZ-0049-PROBE', code, 'reset');
  if (r->>'ok')::boolean then raise exception 'An expired code was accepted'; end if;
  if r->>'reason' <> 'expired' then
    raise exception 'Expiry gave reason %', r->>'reason';
  end if;

  -- Five wrong guesses and the code is gone, not merely refused.
  perform issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'reset', hash);
  for i in 1..5 loop
    perform check_password_otp('ZZ-0049-PROBE', '111111', 'reset');
  end loop;
  r := check_password_otp('ZZ-0049-PROBE', code, 'reset');
  if (r->>'ok')::boolean then
    raise exception 'The right code still worked after five wrong ones';
  end if;

  -- Asking again retires the code you were sent a moment ago.
  delete from password_otp where employee_id = emp_id;
  perform issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'change', hash);
  select id into otp_id from password_otp
  where employee_id = emp_id and consumed_at is null;
  perform issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'change',
                             crypt('999999', gen_salt('bf')));
  if exists (select 1 from password_otp where id = otp_id and consumed_at is null) then
    raise exception 'Two codes were live at once';
  end if;

  -- Three in fifteen minutes, and no more.
  delete from password_otp where employee_id = emp_id;
  for i in 1..3 loop
    r := issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'reset', hash);
    if not (r->>'ok')::boolean then
      raise exception 'Request % of 3 was refused: %', i, r->>'reason';
    end if;
  end loop;
  r := issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'reset', hash);
  if (r->>'ok')::boolean then raise exception 'A fourth code was issued'; end if;
  if r->>'reason' <> 'rate_limited' then
    raise exception 'The fourth gave reason %', r->>'reason';
  end if;

  -- Somebody with no address cannot use this at all, and is told apart
  -- from somebody who typed the wrong one.
  update employees set work_email = null where id = emp_id;
  delete from password_otp where employee_id = emp_id;
  r := issue_password_otp('ZZ-0049-PROBE', 'probe@cyrix.in', 'reset', hash);
  if (r->>'ok')::boolean then
    raise exception 'A code was issued to somebody with no address on file';
  end if;
  if r->>'reason' <> 'no_email_on_record' then
    raise exception 'No address gave reason %', r->>'reason';
  end if;

  -- Nobody at all.
  r := issue_password_otp('ZZ-NOBODY', 'probe@cyrix.in', 'reset', hash);
  if (r->>'ok')::boolean then raise exception 'A code was issued to nobody'; end if;

  delete from employees where id = emp_id;
  raise notice '0049 self-test passed (codes expire, are consumed once, cap at 5 guesses and 3 sends)';
end $$;
