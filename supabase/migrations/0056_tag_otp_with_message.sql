-- =====================================================================
-- Cyrix KPI  ·  0056  ·  Tying a code to the message that carried it
--
-- 0055 added password_otp.provider_id and mail_events, but nothing ever
-- filled the first one in. Without it the two halves do not meet: the
-- events know a message bounced and the codes know somebody was sent
-- one, and no query joins the two.
--
-- The edge function calls this straight after the provider accepts the
-- message, with the id the provider gave back.
-- =====================================================================

create or replace function tag_password_otp(
  p_ecode       text,
  p_purpose     text,
  p_provider_id text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  emp_id uuid;
  otp_id uuid;
begin
  if coalesce(trim(p_provider_id), '') = '' then return false; end if;

  select id into emp_id from employees
  where upper(ecode) = upper(trim(p_ecode)) and is_active;
  if emp_id is null then return false; end if;

  -- The newest unspent code for that purpose, which is the one just
  -- issued. Deliberately not "every code for this person": an older one
  -- was carried by a different message.
  select id into otp_id from password_otp
  where employee_id = emp_id and purpose = p_purpose and consumed_at is null
  order by created_at desc limit 1;

  if otp_id is null then return false; end if;

  update password_otp set provider_id = trim(p_provider_id) where id = otp_id;
  return true;
end $$;

revoke execute on function tag_password_otp(text, text, text) from public, anon, authenticated;
grant  execute on function tag_password_otp(text, text, text) to service_role;

comment on function tag_password_otp(text, text, text) is
  'Records which provider message carried a code, so its delivery events '
  'in mail_events can be found. Called by the password-otp function.';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  got    text;
begin
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0056-PROBE', 'Probe', 'probe.0056@cyrix.in', true) returning id into emp_id;

  -- Nothing outstanding is not an error, it is a no-op.
  if tag_password_otp('ZZ-0056-PROBE', 'reset', 'msg_1') then
    raise exception 'A code was tagged when none had been issued';
  end if;

  perform issue_password_otp('ZZ-0056-PROBE', 'probe.0056@cyrix.in', 'reset', '111111');
  if not tag_password_otp('ZZ-0056-PROBE', 'reset', 'msg_1') then
    raise exception 'An issued code could not be tagged';
  end if;
  select provider_id into got from password_otp where employee_id = emp_id;
  if got <> 'msg_1' then raise exception 'Wrong id stored: %', got; end if;

  -- A second code is a second message; the first keeps its own id.
  perform issue_password_otp('ZZ-0056-PROBE', 'probe.0056@cyrix.in', 'reset', '222222');
  perform tag_password_otp('ZZ-0056-PROBE', 'reset', 'msg_2');
  if (select count(*) from password_otp
      where employee_id = emp_id and provider_id = 'msg_1') <> 1 then
    raise exception 'Tagging overwrote an older message';
  end if;
  if (select provider_id from password_otp
      where employee_id = emp_id and consumed_at is null) <> 'msg_2' then
    raise exception 'The live code carries the wrong message id';
  end if;

  -- Blank is refused rather than stored.
  if tag_password_otp('ZZ-0056-PROBE', 'reset', '   ') then
    raise exception 'A blank message id was accepted';
  end if;

  -- The join this exists for: a code, and what happened to its message.
  perform record_mail_event('msg_2', 'email.bounced', 'probe.0056@cyrix.in');
  if not exists (
    select 1 from password_otp o
    join v_mail_status s on s.provider_id = o.provider_id
    where o.employee_id = emp_id and s.status = 'bounced'
  ) then
    raise exception 'A code cannot be joined to its delivery outcome';
  end if;

  -- No browser may write one.
  if has_function_privilege('anon', 'tag_password_otp(text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'tag_password_otp(text,text,text)', 'execute') then
    raise exception 'A browser can tag a code with any message id';
  end if;

  delete from mail_events where provider_id in ('msg_1', 'msg_2');
  delete from password_otp where employee_id = emp_id;
  delete from employees where id = emp_id;
  raise notice '0056 self-test passed (a code now knows which message carried it)';
end $$;
