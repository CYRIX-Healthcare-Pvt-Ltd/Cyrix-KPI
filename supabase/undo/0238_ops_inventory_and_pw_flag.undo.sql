-- Undo 0238: drop the inventory target and restore 0237's ops_pw_scan. must_change_password flags already set are left alone.
delete from ops_target where id = 'inventory';
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
  )
  insert into ops_pw_check (employee_id, is_default, checked_at)
  select id, hash = extensions.crypt(code, hash), now() from due
  on conflict (employee_id) do update set is_default = excluded.is_default, checked_at = excluded.checked_at;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function ops_pw_scan(int) from public, anon, authenticated;
delete from _migrations where filename = '0238_ops_inventory_and_pw_flag.sql';
