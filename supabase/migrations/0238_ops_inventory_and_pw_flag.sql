-- =====================================================================
-- Cyrix KPI  ·  0238  ·  Inventory in the uptime checks; default
--                        passwords marked for a forced change
--
-- 1. cyrix-inventory joins ops_target, so the 5-minute ops_round()
--    checks it like every other app.
--
-- 2. ops_pw_scan() (0237) already finds accounts whose password is still
--    their employee code. It now also sets must_change_password on each
--    one it finds. employees.must_change_password was only ever set when
--    an admin created or reset an account, so just 109 of 1,197 carried
--    it, while the scan finds roughly 40% on the default.
--
--    The flag does nothing by itself. App.tsx sends a flagged employee to
--    /change-password only while app_settings.force_password_change is
--    true, and it is false today. Turning that on is a separate decision,
--    kept out of this file on purpose (see the apply file).
--
--    The scan only ever sets the flag, never clears it. ChangePassword
--    clears it when somebody picks a real password, and the next scan of
--    that account records is_default = false.
-- =====================================================================

insert into ops_target (id, name, grp, url, timeout_ms, sort_order) values
  ('inventory', 'Inventory', 'Vercel', 'https://cyrix-inventory.vercel.app/inventory/', 10000, 75)
on conflict (id) do update set url = excluded.url, name = excluded.name, active = true;

create or replace function ops_pw_scan(p_batch int default 120)
returns int
language plpgsql security definer
set search_path = public, extensions
as $$
declare n int;
begin
  with due as (
    select e.id, upper(e.ecode) code, u.encrypted_password hash
    from employees e
    join auth.users u on u.id = e.auth_user_id
    left join ops_pw_check c on c.employee_id = e.id
    where e.is_active and u.encrypted_password is not null and u.encrypted_password <> ''
    order by c.checked_at nulls first
    limit greatest(1, least(coalesce(p_batch, 120), 500))
  ), checked as (
    insert into ops_pw_check (employee_id, is_default, checked_at)
    select id, hash = extensions.crypt(code, hash), now() from due
    on conflict (employee_id) do update set is_default = excluded.is_default, checked_at = excluded.checked_at
    returning employee_id, is_default
  ), flagged as (
    update employees e set must_change_password = true
    from checked c
    where c.employee_id = e.id and c.is_default and not e.must_change_password
    returning e.id
  )
  select count(*) into n from checked;
  return n;
end $$;

revoke all on function ops_pw_scan(int) from public, anon, authenticated;

-- Catch up the accounts already scanned before this file.
update employees e set must_change_password = true
from ops_pw_check c
where c.employee_id = e.id and c.is_default and e.is_active and not e.must_change_password;

do $$
begin
  if not exists (select 1 from ops_target where id = 'inventory' and active) then
    raise exception '0238: inventory target missing';
  end if;
  if pg_get_functiondef('ops_pw_scan(int)'::regprocedure) not like '%must_change_password%' then
    raise exception '0238: ops_pw_scan does not flag';
  end if;
end $$;
