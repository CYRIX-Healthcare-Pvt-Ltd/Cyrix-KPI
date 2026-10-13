-- Device check switched off for everyone (the user, 13 Oct: urgent). Uses the 0150 per-person switch.
insert into public.device_check_off (employee_id)
select id from public.employees where is_active
on conflict do nothing;
