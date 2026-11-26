-- =====================================================================
-- Cyrix KPI  ·  0224  ·  Cyra Assist: who holds it, for its admin Summary
--
-- The user, 28 Oct, on Cyra Assist → Admin → Summary: "in download, all
-- those who have access should be there", "why engineer?" (people who came
-- in through the portal have no name in Cyra's own profiles), and "in
-- excel, reporting manager also, function also. ie kl bemmp etc".
--
-- cyra_people(p_ecodes) gives everyone who holds Cyra Assist, plus anyone
-- in p_ecodes (people who used it and no longer hold it), with name,
-- function, location and reporting manager. The Cyra app asks it with the
-- portal's own session. Cyra Assist admins (cyra_access.admin) and the
-- software administrator only.
-- =====================================================================

create or replace function cyra_people(p_ecodes text[] default '{}')
returns table (ecode text, full_name text, designation text, function_name text, location text,
               manager_name text, manager_ecode text, has_access boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (is_sw_admin() or exists (select 1 from cyra_access a where a.employee_id = current_employee_id() and a.admin)) then
    raise exception 'Only a Cyra Assist admin can see this list';
  end if;
  return query
  select e.ecode, e.full_name, e.designation, e.function_name, e.location,
         m.full_name, m.ecode, (h.employee_id is not null and e.is_active)
  from employees e
  left join employee_modules h on h.employee_id = e.id and h.module_code = 'cyra'
  left join employees m on m.id = e.reporting_manager_id
  where (h.employee_id is not null and e.is_active)
     or upper(e.ecode) = any (select upper(x) from unnest(coalesce(p_ecodes, '{}')) x)
  order by e.full_name;
end $$;

revoke all on function cyra_people(text[]) from public, anon;
grant execute on function cyra_people(text[]) to authenticated, service_role;
