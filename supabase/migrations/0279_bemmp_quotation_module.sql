/*
 * The Quotation tracker is a BEMMP module like the contracts (the user, 11 Nov):
 * 'qt' in profile.scope. Everybody already given a tracker role gets it
 * first, quietly. The notice stays quiet for 'qt' too until the user has
 * tested it and says to send (the user, 11 Nov).
 */
update public.profile p set scope = array_append(coalesce(p.scope, '{}'), 'qt')
from public.employees e join public.qt_people q on q.employee_id = e.id
where p.code = e.ecode and not ('qt' = any (coalesce(p.scope, '{}')));

create or replace function public.bemmp_project_notify() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare e uuid; p text; nm text;
begin
  select id into e from employees where auth_user_id = new.id and is_active;
  if e is null or not exists (select 1 from employee_modules where employee_id = e and module_code = 'bemmp') then
    return null;
  end if;
  for p in select unnest(new.scope) except select unnest(coalesce(old.scope, '{}'::text[])) loop
    nm := case p when 'kl' then 'Kerala' when 'ap' then 'Andhra Pradesh'
                 when 'up' then 'Uttar Pradesh' when 'mt' then 'Medtronic' when 'pm' then 'PM checklist' end;
    -- 'qt' (Quotation tracker) stays quiet until the user has tested it (the user, 11 Nov); add it here then.
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
