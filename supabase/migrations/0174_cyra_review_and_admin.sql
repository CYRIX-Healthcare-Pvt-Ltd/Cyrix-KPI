-- =====================================================================
-- Cyrix KPI  ·  0174  ·  CYRA: Review and Admin, ticked in Software Admin
--
-- The user, 12 Oct: "need a tab in software admin, cyra, in that for each
-- user, we need check box, extra option ie review and admin", "defaultly
-- review and admin should be disabled", "existing keep admin n review".
--
-- cyra_access holds the two boxes per person; nobody's row means both off.
-- CYRA's engine reads them through cyra_whoami() at each sign-in from the
-- portal and gives or takes CYRA's review roles (validator, manual_expert,
-- historical_expert) and admin to match. Seeded from the review and admin
-- roles CYRA held on 12 Oct, matched by work email.
-- =====================================================================

create table if not exists cyra_access (
  employee_id uuid primary key references employees (id) on delete cascade,
  review boolean not null default false,
  admin boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references employees (id)
);
alter table cyra_access enable row level security;
revoke all on cyra_access from anon, authenticated;

insert into cyra_access (employee_id, review, admin)
select e.id, s.review, s.admin
from (values
  ('E1017', true, false),
  ('E1194', true, false),
  ('E1220', true, false),
  ('E1243', true, false),
  ('E1274', true, false),
  ('E1337', true, false),
  ('E1349', true, true),
  ('E1366', true, false),
  ('E1386', true, false),
  ('E1393', true, false),
  ('E1442', true, true),
  ('E1462', true, false),
  ('E1468', true, true),
  ('E1536', true, true),
  ('E1554', true, false),
  ('E1560', true, false),
  ('E1576', true, false),
  ('E1654', true, false),
  ('E1662', true, false),
  ('E1766', true, false),
  ('E1776', true, false),
  ('E1809', true, false),
  ('E1901', true, false),
  ('E197', true, false),
  ('E2', true, false),
  ('E2011', true, true),
  ('E2032', true, true),
  ('E2200', true, false),
  ('E2266', true, false),
  ('E2273', true, false),
  ('E331', true, false),
  ('E375', true, false),
  ('E605', true, true),
  ('E619', true, false),
  ('E870', true, false),
  ('E874', true, false),
  ('E929', true, false),
  ('E986', true, false)
) as s(ecode, review, admin)
join employees e on e.ecode = s.ecode
on conflict (employee_id) do nothing;

-- Everyone who holds CYRA, with their boxes. Software Admin only.
create or replace function cyra_access_list()
returns table (employee_id uuid, ecode text, full_name text, designation text, function_name text,
               location text, review boolean, admin boolean, updated_at timestamptz, updated_by_name text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can see CYRA access'; end if;
  return query
  select e.id, e.ecode, e.full_name, e.designation, e.function_name, e.location,
         coalesce(a.review, false), coalesce(a.admin, false), a.updated_at, u.full_name
  from employees e
  join employee_modules m on m.employee_id = e.id and m.module_code = 'cyra'
  left join cyra_access a on a.employee_id = e.id
  left join employees u on u.id = a.updated_by
  where e.is_active
  order by e.full_name;
end $$;
revoke all on function cyra_access_list() from public, anon;
grant execute on function cyra_access_list() to authenticated;

create or replace function set_cyra_access(p_employee_id uuid, p_review boolean, p_admin boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_sw_admin() then raise exception 'Only the software administrator can change CYRA access'; end if;
  insert into cyra_access (employee_id, review, admin, updated_at, updated_by)
  values (p_employee_id, coalesce(p_review, false), coalesce(p_admin, false), now(), current_employee_id())
  on conflict (employee_id) do update
  set review = excluded.review, admin = excluded.admin, updated_at = now(), updated_by = excluded.updated_by;
end $$;
revoke all on function set_cyra_access(uuid, boolean, boolean) from public, anon;
grant execute on function set_cyra_access(uuid, boolean, boolean) to authenticated;

drop function if exists cyra_whoami();
create function cyra_whoami()
returns table (
  id uuid, ecode text, full_name text, work_email text, department text,
  function_name text, designation text, grade text, location text,
  is_active boolean, password_is_default boolean, has_module boolean,
  email_shared boolean, cyra_review boolean, cyra_admin boolean
)
language sql security definer stable
set search_path = public
as $$
  -- The caller's own row only.
  select e.id, e.ecode, e.full_name, e.work_email, e.department,
         e.function_name, e.designation, e.grade, e.location,
         e.is_active, e.password_is_default,
         exists (select 1 from employee_modules m
                 join app_modules a on a.code = m.module_code and a.is_active
                 where m.employee_id = e.id and m.module_code = 'cyra'),
         exists (select 1 from employees o
                 where o.id <> e.id and o.is_active
                   and lower(btrim(o.work_email)) = lower(btrim(e.work_email))),
         coalesce((select c.review from cyra_access c where c.employee_id = e.id), false),
         coalesce((select c.admin from cyra_access c where c.employee_id = e.id), false)
  from employees e
  where e.auth_user_id = auth.uid()
$$;
revoke all on function cyra_whoami() from public, anon;
grant execute on function cyra_whoami() to authenticated;
