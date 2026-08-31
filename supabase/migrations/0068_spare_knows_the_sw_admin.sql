-- =====================================================================
-- Cyrix KPI  ·  0068  ·  Spare can tell who administers the software
--
-- Spare has one admin role and it means two different jobs. Somebody
-- marked admin should be able to maintain the custom fields — the list
-- of things an engineer fills in when tagging a spare, which is Spare's
-- own business and changes with the work. Setting up warehouses, loading
-- item masters, creating logins and changing settings is not that job;
-- it is administering the software, and it now belongs on the shared
-- Administration screen with every other module's setup.
--
-- The module cannot tell the two apart on its own. `profiles.role` says
-- `admin` for both, because 0059 syncs that from KPI's hr_admin and
-- sw_admin. So it asks.
--
-- A function rather than a column: this is a fact about KPI's user_roles
-- and copying it into profiles would be a second answer to a question
-- that already has one, out of date the moment somebody's roles change.
-- =====================================================================

create or replace function public.is_sw_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from user_roles ur
    join employees e on e.id = ur.employee_id
    where e.auth_user_id = auth.uid()
      and ur.role = 'sw_admin'
  );
$$;

grant execute on function public.is_sw_admin() to authenticated;

comment on function public.is_sw_admin() is
  'True for the account that administers the software itself. Spare asks '
  'this to decide whether its admin section offers the custom fields '
  'alone, or the whole setup. Definer because user_roles is KPI''s table '
  'and a Spare user has no business reading the rest of it.';

notify pgrst, 'reload schema';

-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n integer;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.proname = 'is_sw_admin'
  ) then
    raise exception 'is_sw_admin was not created';
  end if;

  -- Somebody has to hold the role, or the function is correct and
  -- useless: Spare would show its setup to nobody at all.
  select count(*) into n from user_roles where role = 'sw_admin';
  if n = 0 then
    raise exception 'no account holds sw_admin; Spare setup would be unreachable';
  end if;

  raise notice '0068 self-test passed (% sw_admin account(s))', n;
end $selftest$;
