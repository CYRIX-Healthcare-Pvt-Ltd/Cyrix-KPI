-- =====================================================================
-- Cyrix KPI  ·  0051  ·  Shutting the door the OTP replaced
--
-- 0049 and 0050 put a one-time code in front of a password reset, and
-- the login screen now asks for one. None of that is worth anything
-- while request_password_reset() is still granted to anon.
--
-- That function sets an account's password back to its own employee
-- code, and it is callable by anybody who is not signed in — which is
-- the design, because somebody who is locked out is by definition not
-- signed in. The anon key it needs is compiled into the JavaScript every
-- visitor downloads, and the employee codes are printed on badges. Two
-- public facts and one HTTP request is the whole attack.
--
-- Leaving it reachable would make the code on the login screen a costume
-- rather than a lock: the form asks for an OTP while the API underneath
-- it still hands out accounts. So the grant goes.
--
-- The function itself stays. HR's own reset (admin_reset_password, 0015)
-- is a different thing entirely — it needs a signed-in HR admin, it is
-- how somebody with no address on record gets back in, and it is
-- untouched here.
-- =====================================================================

revoke execute on function request_password_reset(text) from anon, authenticated;

comment on function request_password_reset(text) is
  'RETIRED as a self-service route (0051). Sets a password back to the '
  'employee code, which is public information — reachable now only by '
  'service_role. Self-service reset goes through the password-otp edge '
  'function, which proves the person owns the address on their record '
  'before anything changes. HR resets use admin_reset_password.';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- The grants are the entire point of this migration, so they are what
-- gets checked — including the two that must NOT have changed.
-- ---------------------------------------------------------------------
do $$
declare
  can_anon boolean;
  can_auth boolean;
  can_hr   boolean;
  otp_anon boolean;
begin
  select has_function_privilege('anon', 'request_password_reset(text)', 'execute')
    into can_anon;
  select has_function_privilege('authenticated', 'request_password_reset(text)', 'execute')
    into can_auth;

  if can_anon then
    raise exception 'A stranger can still reset an account to its employee code';
  end if;
  if can_auth then
    raise exception 'Any signed-in account can still reset a password to an employee code';
  end if;

  -- HR's route is not this one and must survive untouched: it is how
  -- somebody with no email on their record gets back in at all.
  select has_function_privilege('authenticated', 'admin_reset_password(uuid)', 'execute')
    into can_hr;
  if not can_hr then
    raise exception 'HR lost their own reset, which is the fallback for people with no email';
  end if;

  -- And the new door stays shut to browsers, as 0049 and 0050 left it.
  select has_function_privilege('anon', 'issue_password_otp(text,text,text,text)', 'execute')
    into otp_anon;
  if otp_anon then
    raise exception 'The OTP issuer is reachable from a browser';
  end if;

  raise notice '0051 self-test passed (ecode reset is service_role only; HR reset and the OTP grants are as they were)';
end $$;
