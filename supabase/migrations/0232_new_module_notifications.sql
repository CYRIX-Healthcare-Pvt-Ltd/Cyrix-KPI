-- =====================================================================
-- Cyrix KPI  ·  0232  ·  A new module, or a new BEMMP project, tells its person
--
-- The user, 31 Oct 2026: "so whenever new modules assigned can we give
-- device notifications?" Modules and BEMMP projects both, and everyone in
-- a grant to many gets their own.
--
-- Each grant puts a message in the person's bell (kind 'module'), and the
-- push function's 5-minute round sends it to their devices, as it does
-- Travel's. Only a grant somebody made counts (granted_by): the KPI and
-- My Task a new joiner is handed on the way in are not news. A module
-- taken away and given back the same day does not say so twice.
-- =====================================================================

alter table push_messages drop constraint if exists push_messages_kind_check;
alter table push_messages add constraint push_messages_kind_check
  check (kind in ('manual', 'reminder', 'travel', 'ops', 'module'));

create or replace function public.push_queue_module(
  p_employee uuid, p_title text, p_body text, p_url text, p_key text, p_by uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  insert into push_messages (kind, title, body, url, target, sent_by, people, dedupe_key)
  values ('module', p_title, p_body, p_url, jsonb_build_object('kind', 'module'), p_by, 1,
          p_key || ':' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'))
  on conflict (dedupe_key) do nothing
  returning id into mid;
  if mid is not null then
    insert into push_inbox (message_id, employee_id) values (mid, p_employee);
  end if;
end $$;
revoke execute on function public.push_queue_module(uuid, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.module_granted_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare m app_modules;
begin
  if new.granted_by is null then
    return null;
  end if;
  select * into m from app_modules where code = new.module_code and is_active;
  if m.code is null or not exists (select 1 from employees where id = new.employee_id and is_active) then
    return null;
  end if;
  perform push_queue_module(new.employee_id,
    'New module: ' || m.name,
    m.name || ' is now assigned to you. Open it from the Cyrix portal.',
    m.path || '/',
    'module:' || new.employee_id || ':' || m.code,
    new.granted_by);
  return null;
end $$;
revoke execute on function public.module_granted_notify() from public, anon, authenticated;

drop trigger if exists employee_modules_notify on employee_modules;
create trigger employee_modules_notify after insert on employee_modules
  for each row execute function module_granted_notify();

-- A BEMMP project ticked for somebody who has the BEMMP tile. The names are
-- the contracts' own; a new contract goes here too (KPI SwAdmin CONTRACTS,
-- BEMMP AdminTab and api/users.js are the others).
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
                 when 'up' then 'Uttar Pradesh' when 'mt' then 'Medtronic' end;
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

drop trigger if exists profile_bemmp_project_notify on profile;
create trigger profile_bemmp_project_notify after update of scope on profile
  for each row when (new.scope is distinct from old.scope)
  execute function bemmp_project_notify();
