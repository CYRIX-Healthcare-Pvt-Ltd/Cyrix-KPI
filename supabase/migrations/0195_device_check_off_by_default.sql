-- Device check off by default (the user, 15 Oct): E1971, added after 0189, was still checked.
-- Everyone now, active or not, is off; anyone added later is off too, unless SW Admin last
-- switched it On for all, which app_settings.device_check_new_joiners remembers.
insert into public.device_check_off (employee_id)
select id from public.employees
on conflict do nothing;

insert into public.app_settings (key, value) values ('device_check_new_joiners', 'false'::jsonb)
on conflict (key) do update set value = 'false'::jsonb;

create or replace function public.device_check_off_for_new()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  if coalesce((select value::text::boolean from app_settings where key = 'device_check_new_joiners'), false) is not true then
    insert into device_check_off (employee_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $f$;
drop trigger if exists device_check_off_for_new on public.employees;
create trigger device_check_off_for_new after insert on public.employees
for each row execute function public.device_check_off_for_new();

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
    select id, current_employee_id() from employees
    on conflict (employee_id) do nothing;
    select count(*) into n from device_check_off;
  end if;
  -- New joiners follow the last "for all" choice.
  insert into app_settings (key, value) values ('device_check_new_joiners', to_jsonb(p_on))
  on conflict (key) do update set value = to_jsonb(p_on);
  perform log_audit('employee', current_employee_id(), case when p_on then 'device_check_on_all' else 'device_check_off_all' end, '{}'::jsonb);
  return n;
end $f$;
