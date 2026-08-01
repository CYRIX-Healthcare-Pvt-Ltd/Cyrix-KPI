-- =====================================================================
-- Cyrix KPI  ·  0013  ·  Track whether a password is still the issued one
--
-- The login screen was inferring "still on the default" from
-- must_change_password. That flag means something different: whether the
-- app should FORCE a change at sign-in. Testing mode switched it off for
-- everyone, so every account reported as having set its own password.
--
-- Two separate facts, so two separate columns:
--   must_change_password   should we interrupt them at sign-in?
--   password_is_default    is the password still the one we issued?
-- =====================================================================

alter table employees
  add column if not exists password_is_default boolean not null default true;

comment on column employees.password_is_default is
  'True while the account still uses the ecode we issued. Cleared only when '
  'the person sets their own password, and set again by an admin reset. '
  'Never implies the password is readable — it is a bcrypt hash either way.';

-- Backfill from what we know: everyone was reset to ecode-as-password by
-- scripts/user-admin.mjs reset-all, and nobody has changed one since.
update employees set password_is_default = true;

create or replace view v_login_status as
select
  e.id                      as employee_id,
  e.ecode,
  e.full_name,
  e.designation,
  e.department,
  e.is_active,
  m.ecode                   as manager_ecode,
  m.full_name               as manager_name,
  u.email                   as login_email,
  (u.id is not null)        as has_login,
  e.password_is_default     as on_issued_default,
  u.created_at              as login_created_at,
  u.last_sign_in_at,
  u.updated_at              as password_changed_at,
  case
    when u.id is null                 then 'No login issued'
    when e.password_is_default
     and u.last_sign_in_at is null    then 'Never signed in'
    when e.password_is_default        then 'Using the issued default'
    else                                   'Set their own password'
  end                       as login_state
from employees e
left join auth.users u on u.id = e.auth_user_id
left join employees m on m.id = e.reporting_manager_id;

revoke all on v_login_status from public, anon;
grant select on v_login_status to authenticated;

create or replace function login_status()
returns setof v_login_status
language sql stable security definer set search_path = public as $$
  select * from v_login_status
  where is_sw_admin() or is_hr_admin()
$$;

grant execute on function login_status() to authenticated;

-- Setting your own password clears the flag. Kept as an RPC so the client
-- cannot simply PATCH the column to whatever it likes.
create or replace function mark_password_changed()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update employees
  set password_is_default = false, must_change_password = false
  where auth_user_id = auth.uid();
end $$;

grant execute on function mark_password_changed() to authenticated;
