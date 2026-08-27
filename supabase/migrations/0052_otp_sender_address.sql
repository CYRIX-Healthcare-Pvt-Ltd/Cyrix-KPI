-- =====================================================================
-- Cyrix KPI  ·  0052  ·  The address codes come from, as a setting
--
-- OTP_FROM was an edge-function secret, which means changing it needs
-- the CLI, a Supabase login with the right account, and a redeploy. That
-- is a fine way to configure something nobody ever changes. It is a poor
-- way to configure the one field that decides whether password resets
-- work at all — the moment it needs changing is the moment somebody is
-- locked out and the person who can change it is asleep.
--
-- So it lives beside the other settings, and SW Admin owns it, the way
-- SW Admin already owns the TAT policy and the login switches.
--
-- The secret still works as a fallback. Nothing breaks if this row is
-- deleted, and a deployment that has not been told anything still sends.
-- =====================================================================

insert into app_settings (key, value, description)
values (
  'otp_from',
  '"Cyrix KPI <no-reply@send.cyrix.in>"'::jsonb,
  'The From address on password reset and change codes. Must be at a '
  'domain verified with the mail provider, or every send is rejected. '
  'Deliberately a subdomain: verifying cyrix.in itself would put an SPF '
  'record beside the one Microsoft 365 relies on for the whole company.'
)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- Setting it.
--
-- Validated here rather than in the form, because a form is one client
-- and this is the field that silently breaks every reset in the company
-- when it is wrong.
-- ---------------------------------------------------------------------
create or replace function set_otp_from(p_from text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := trim(coalesce(p_from, ''));
  addr    text;
begin
  if not is_sw_admin() then
    raise exception 'Only SW Admin can change the sender address';
  end if;

  if cleaned = '' then
    raise exception 'Enter an address for codes to come from';
  end if;

  -- Two shapes are allowed: a bare address, or a display name in front
  -- of one in angle brackets. The display name is what people actually
  -- see in their inbox, so it is worth keeping.
  if cleaned ~ '^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$' then
    addr := substring(cleaned from '<([^<>]+)>');
  elsif cleaned ~ '^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$' then
    addr := cleaned;
  else
    raise exception
      'That is not a valid sender. Use name@domain, or Display Name <name@domain>';
  end if;

  update app_settings set value = to_jsonb(cleaned), updated_at = now()
  where key = 'otp_from';

  if not found then
    insert into app_settings (key, value, description)
    values ('otp_from', to_jsonb(cleaned), 'The From address on password codes.');
  end if;

  perform log_audit('app_settings', null, 'otp_from_changed',
                    jsonb_build_object('from', cleaned, 'address', addr));
  return cleaned;
end $$;

grant execute on function set_otp_from(text) to authenticated;


-- ---------------------------------------------------------------------
-- Reading it, and who to send a test to.
--
-- Both service_role only: they are for the edge function, not a browser.
-- The test recipient is deliberately not a parameter — a "send a test
-- anywhere" button on an admin screen is a way to use the company's mail
-- reputation to send anything to anyone.
-- ---------------------------------------------------------------------
create or replace function otp_sender()
returns text
language sql stable security definer set search_path = public as $$
  select value #>> '{}' from app_settings where key = 'otp_from'
$$;

create or replace function otp_test_recipient(p_ecode text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  emp employees%rowtype;
begin
  select e.* into emp from employees e
  join user_roles ur on ur.employee_id = e.id
  where upper(e.ecode) = upper(trim(p_ecode))
    and e.is_active
    and ur.role in ('sw_admin', 'super_admin');

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_sw_admin');
  end if;
  if emp.work_email is null or trim(emp.work_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email_on_record');
  end if;

  return jsonb_build_object(
    'ok', true, 'email', lower(trim(emp.work_email)), 'name', emp.full_name);
end $$;

revoke execute on function otp_sender()             from public, anon, authenticated;
revoke execute on function otp_test_recipient(text) from public, anon, authenticated;
grant  execute on function otp_sender()             to service_role;
grant  execute on function otp_test_recipient(text) to service_role;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  sw_id  uuid;
  r      jsonb;
  got    text;
begin
  -- The setting exists and reads back as a plain string, not as a JSON
  -- string with quotes still around it.
  got := otp_sender();
  if got is null then raise exception 'otp_from was not seeded'; end if;
  if got like '"%' then
    raise exception 'otp_sender() returned a quoted JSON string: %', got;
  end if;
  if got not like '%@%' then raise exception 'The seeded sender is not an address: %', got; end if;

  -- Only SW Admin may set it, and there is no JWT here at all.
  begin
    perform set_otp_from('someone@cyrix.in');
    raise exception 'Anybody could change the sender address';
  exception when others then
    if sqlerrm not like '%Only SW Admin%' then raise; end if;
  end;

  -- A test recipient is only ever an SW Admin with an address on record.
  insert into employees (ecode, full_name, work_email, is_active)
  values ('ZZ-0052-PROBE', 'Probe', 'probe@cyrix.in', true) returning id into emp_id;

  r := otp_test_recipient('ZZ-0052-PROBE');
  if (r->>'ok')::boolean then
    raise exception 'A test could be sent to somebody who is not SW Admin';
  end if;

  insert into user_roles (employee_id, role) values (emp_id, 'sw_admin');
  r := otp_test_recipient('ZZ-0052-PROBE');
  if not (r->>'ok')::boolean then
    raise exception 'An SW Admin could not receive a test: %', r->>'reason';
  end if;
  if r->>'email' <> 'probe@cyrix.in' then
    raise exception 'Wrong recipient: %', r->>'email';
  end if;

  update employees set work_email = null where id = emp_id;
  r := otp_test_recipient('ZZ-0052-PROBE');
  if (r->>'ok')::boolean then
    raise exception 'A test was addressed to somebody with no address';
  end if;

  delete from user_roles where employee_id = emp_id;
  delete from employees where id = emp_id;

  -- Validation, exercised directly since set_otp_from needs a JWT.
  for got in select unnest(array[
    'no-reply@send.cyrix.in',
    'Cyrix KPI <no-reply@send.cyrix.in>',
    'A B  C <x.y@a.b.co.in>'
  ]) loop
    if not (got ~ '^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$'
            or got ~ '^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$') then
      raise exception 'A valid sender was rejected: %', got;
    end if;
  end loop;

  for got in select unnest(array[
    'no-reply', 'no-reply@localhost', 'Cyrix KPI <no-reply>',
    'a@b.c d@e.f', '<>', 'Cyrix <a@b.c'
  ]) loop
    if (got ~ '^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$'
        or got ~ '^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$') then
      raise exception 'An invalid sender was accepted: %', got;
    end if;
  end loop;

  raise notice '0052 self-test passed (sender is a setting, SW Admin owns it, tests go only to them)';
end $$;
