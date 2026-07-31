-- =====================================================================
-- Cyrix KPI  ·  0009  ·  Testing-phase password handling
--
-- During the testing phase everyone signs in with their ecode as both
-- user id and password, with no forced change and self-service reset.
--
-- BOTH BEHAVIOURS ARE FLAGS, NOT CODE. When management approves and this
-- goes live, tightening it is two UPDATEs and no deployment:
--
--   update app_settings set value = 'true'  where key = 'force_password_change';
--   update app_settings set value = 'false' where key = 'self_service_password_reset';
--
-- WHAT SELF-SERVICE RESET MEANS
-- -----------------------------
-- request_password_reset() is callable by ANONYMOUS users, because the
-- person using it is by definition locked out and sitting on the login
-- screen. Anyone who knows a colleague's employee code can therefore
-- reset that colleague's password back to their ecode.
--
-- That is acceptable while this holds test data and nothing else. It is
-- NOT acceptable once real appraisal and PIP records are in here, which
-- is why it is behind a flag that is checked on every call rather than
-- something that has to be remembered and removed later.
-- =====================================================================

insert into app_settings (key, value, description) values
  ('force_password_change', 'false'::jsonb,
   'Force a new password on first login. FALSE during testing so everyone can '
   'sign in with ecode/ecode. Set to true before go-live.'),
  ('self_service_password_reset', 'true'::jsonb,
   'Allow anyone to reset an account back to ecode-as-password from the login '
   'screen, without HR. TRUE during testing. Set to false before go-live — it '
   'lets anyone who knows an employee code take over that account.')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;


-- ---------------------------------------------------------------------
-- Self-service reset, called from the "Forgot password?" link.
--
-- Writes the bcrypt hash directly. pgcrypto's gen_salt('bf', 10) produces
-- the same $2a$10$ format GoTrue itself writes, so the reset password
-- validates normally on the next sign-in.
-- ---------------------------------------------------------------------
create or replace function request_password_reset(p_ecode text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  enabled      boolean;
  force_change boolean;
  emp          record;
begin
  select coalesce(value::text::boolean, false) into enabled
  from app_settings where key = 'self_service_password_reset';

  if not coalesce(enabled, false) then
    raise exception 'Password reset is handled by HR. Please contact them.';
  end if;

  select e.id, e.ecode, e.auth_user_id into emp
  from employees e
  where upper(e.ecode) = upper(trim(p_ecode)) and e.is_active;

  -- This confirms whether an employee code exists. Acceptable for an
  -- internal tool during testing, and it makes the message actually
  -- useful; revisit alongside the self_service flag before go-live.
  if not found then
    raise exception 'No active account found for employee code %.', upper(trim(p_ecode));
  end if;
  if emp.auth_user_id is null then
    raise exception 'That account has no login yet. Please contact HR.';
  end if;

  select coalesce(value::text::boolean, false) into force_change
  from app_settings where key = 'force_password_change';

  update auth.users
  set encrypted_password = extensions.crypt(
        upper(emp.ecode), extensions.gen_salt('bf', 10)),
      updated_at = now()
  where id = emp.auth_user_id;

  update employees
  set must_change_password = coalesce(force_change, false)
  where id = emp.id;

  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (emp.id, 'employee', emp.id, 'self_service_password_reset',
          jsonb_build_object('ecode', upper(emp.ecode)));

  return jsonb_build_object('ok', true, 'ecode', upper(emp.ecode));
end $$;

comment on function request_password_reset(text) is
  'Resets an account back to ecode-as-password from the login screen. '
  'Gated on the self_service_password_reset setting. Callable anonymously '
  'by design — the caller is locked out and cannot authenticate.';

revoke all on function request_password_reset(text) from public;
grant execute on function request_password_reset(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Bulk reset, for the testing phase. HR-only.
-- ---------------------------------------------------------------------
create or replace function reset_all_passwords_to_ecode()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n            integer;
  force_change boolean;
begin
  if not is_hr_admin() then
    raise exception 'Only HR can reset every password';
  end if;

  select coalesce(value::text::boolean, false) into force_change
  from app_settings where key = 'force_password_change';

  update auth.users u
  set encrypted_password = extensions.crypt(
        upper(e.ecode), extensions.gen_salt('bf', 10)),
      updated_at = now()
  from employees e
  where e.auth_user_id = u.id and e.is_active;
  get diagnostics n = row_count;

  update employees
  set must_change_password = coalesce(force_change, false)
  where is_active;

  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (current_employee_id(), 'system', null, 'bulk_password_reset',
          jsonb_build_object('accounts', n));

  return n;
end $$;

revoke all on function reset_all_passwords_to_ecode() from public;
grant execute on function reset_all_passwords_to_ecode() to authenticated;
