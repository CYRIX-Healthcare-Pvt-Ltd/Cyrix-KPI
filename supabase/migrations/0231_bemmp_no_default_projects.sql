-- =====================================================================
-- Cyrix KPI  ·  0231  ·  BEMMP projects are ticked on purpose
--
-- 0062 gave everyone Kerala and Andhra, and every new joiner the same,
-- when BEMMP was one company-wide dashboard and the BEMMP tile was the
-- only gate. With projects of their own (Uttar Pradesh, Medtronic) that
-- default showed Kerala and Andhra to whoever was given the tile, chosen
-- by nobody (the user, 31 Oct 2026: "why when assigning bemmp module to
-- someone default is ap and kl?").
--
-- New joiners start with no project. The 0062 default is cleared from
-- everyone without the BEMMP tile; those with it keep their ticks.
-- =====================================================================

create or replace function public.bemmp_sync_profile_from_employee()
returns trigger
language plpgsql security definer set search_path = public as $bemmp_sync$
begin
  if new.auth_user_id is null then
    return new;
  end if;

  -- No project to start with: SW Admin → BEMMP ticks them (0231).
  insert into profile (id, code, full_name, role, scope)
  values (new.auth_user_id, new.ecode, new.full_name,
          'coordinator'::app_role, '{}'::text[])
  on conflict (id) do update set
    code      = excluded.code,
    full_name = excluded.full_name;
    -- role and scope untouched on update: both are BEMMP's to decide once
    -- the row exists.

  return new;
end $bemmp_sync$;

update profile p
set scope = '{}'::text[]
from employees e
where e.auth_user_id = p.id
  and p.scope = array['kl', 'ap']
  and not exists (select 1 from employee_modules em where em.employee_id = e.id and em.module_code = 'bemmp');
