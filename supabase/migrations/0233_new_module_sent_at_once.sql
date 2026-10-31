-- =====================================================================
-- Cyrix KPI  ·  0233  ·  A new module's notification goes the moment it is given
--
-- 0232 left it for the push function's 5-minute round (the user, 31 Oct:
-- "when modules is assigned, why at that time itself it is not going?").
-- Once a grant or a ticked BEMMP project has queued its message, the
-- statement asks the push function to send it now. The request leaves only
-- if the change is saved (pg_net), and the round still sends anything this
-- misses.
-- =====================================================================

create or replace function public.push_queued_now()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- now() is this transaction's start, the created_at of anything it queued.
  if exists (select 1 from push_messages where kind = 'module' and devices is null and created_at = now()) then
    perform push_call('queued');
  end if;
  return null;
end $$;
revoke execute on function public.push_queued_now() from public, anon, authenticated;

drop trigger if exists employee_modules_push_now on employee_modules;
create trigger employee_modules_push_now after insert on employee_modules
  for each statement execute function push_queued_now();

drop trigger if exists profile_push_now on profile;
create trigger profile_push_now after update of scope on profile
  for each statement execute function push_queued_now();
