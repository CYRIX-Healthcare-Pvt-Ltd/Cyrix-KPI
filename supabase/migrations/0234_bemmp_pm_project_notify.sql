-- =====================================================================
-- 0234 · "New in BEMMP: PM checklist"
--
-- The PM checklist is BEMMP's next project (BEMMP 0014; the user, 31 Oct),
-- ticked in SW Admin → BEMMP like Medtronic. Its tick tells the person, as
-- the others do (0232).
-- =====================================================================

create or replace function public.bemmp_project_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare e uuid; p text; nm text;
begin
  select id into e from employees where auth_user_id = new.id and is_active;
  if e is null or not exists (select 1 from employee_modules where employee_id = e and module_code = 'bemmp') then
    return null;
  end if;
  for p in select unnest(new.scope) except select unnest(coalesce(old.scope, '{}'::text[])) loop
    nm := case p when 'kl' then 'Kerala' when 'ap' then 'Andhra Pradesh'
                 when 'up' then 'Uttar Pradesh' when 'mt' then 'Medtronic' when 'pm' then 'PM checklist' end;
    continue when nm is null;
    perform push_queue_module(e,
      'New in BEMMP: ' || nm,
      nm || ' is now assigned to you in BEMMP. Open it from the Cyrix portal.',
      '/bemmp/',
      'bemmp:' || e || ':' || p,
      null);
  end loop;
  return null;
end $$;
revoke execute on function public.bemmp_project_notify() from public, anon, authenticated;
