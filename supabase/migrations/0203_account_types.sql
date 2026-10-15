-- Employee, test or admin account (the user, 15 Oct: test and admin logins were counted as
-- employees in reports). Employee by default; E6666-E9999 are the test logins; the *_ADMIN
-- logins are admin. SW Admin can change it on the Logins tab.
alter table employees add column if not exists account_type text not null default 'employee'
  check (account_type in ('employee', 'test', 'admin'));
update employees set account_type = 'test' where upper(ecode) in ('E6666', 'E7777', 'E8888', 'E9999');
update employees set account_type = 'admin' where position('_' in ecode) > 0;

create or replace function public.set_account_type(p_employee_id uuid, p_type text)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change an account type'; end if;
  if p_type not in ('employee', 'test', 'admin') then raise exception 'Unknown account type'; end if;
  update employees set account_type = p_type where id = p_employee_id;
  perform log_audit('employee', p_employee_id, 'account_type', jsonb_build_object('type', p_type));
end $f$;
revoke all on function public.set_account_type(uuid, text) from public, anon;
grant execute on function public.set_account_type(uuid, text) to authenticated;

-- The accounts that are not employees, as one value (few, but read once for every list).
create or replace function public.non_employee_ids()
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select coalesce(jsonb_object_agg(id, account_type), '{}') from employees where account_type <> 'employee'
$f$;
revoke all on function public.non_employee_ids() from public, anon;
grant execute on function public.non_employee_ids() to authenticated;
