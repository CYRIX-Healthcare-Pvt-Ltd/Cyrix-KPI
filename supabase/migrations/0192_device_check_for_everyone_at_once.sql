-- Device check on or off for everyone at once, from the Logins tab (the user, 14 Oct).
create or replace function public.set_device_check_all(p_on boolean)
returns int language plpgsql security definer set search_path to 'public' as $f$
declare n int;
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can switch the device check';
  end if;
  if p_on then
    delete from device_check_off;
    get diagnostics n = row_count;
  else
    insert into device_check_off (employee_id, set_by)
    select id, current_employee_id() from employees where is_active
    on conflict (employee_id) do nothing;
    select count(*) into n from device_check_off;
  end if;
  perform log_audit('employee', current_employee_id(), case when p_on then 'device_check_on_all' else 'device_check_off_all' end, '{}'::jsonb);
  return n;
end $f$;
revoke all on function public.set_device_check_all(boolean) from public, anon;
grant execute on function public.set_device_check_all(boolean) to authenticated;
