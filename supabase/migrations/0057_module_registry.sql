-- =====================================================================
-- Cyrix KPI  ·  0057  ·  Which modules a person can see
--
-- app.cyrix.in becomes a portal: a tile per module, and this database
-- holds the roster the portal reads. KPI is one of three today, with
-- Spare Mapping and the BEMMP dashboard beside it and more later.
--
-- The one thing this is NOT is a permission. Hiding a tile does not stop
-- anybody typing the URL, and it must never be the only thing between a
-- person and a module — every module keeps enforcing its own access with
-- its own RLS, exactly as KPI does. This decides what somebody is
-- OFFERED, not what they are allowed.
-- =====================================================================

create table if not exists app_modules (
  code        text primary key,
  name        text not null,
  description text,
  /** Where the portal sends them. One path per module, hence unique. */
  path        text not null unique,
  /** A lucide icon name, resolved by the portal. */
  icon        text,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists employee_modules (
  employee_id uuid not null references employees(id) on delete cascade,
  module_code text not null references app_modules(code) on delete cascade,
  granted_by  uuid references employees(id),
  granted_at  timestamptz not null default now(),
  primary key (employee_id, module_code)
);

create index if not exists idx_employee_modules_person on employee_modules (employee_id);

alter table app_modules      enable row level security;
alter table employee_modules enable row level security;

-- The catalogue is not a secret: it is three rows naming three products
-- the company runs, and the portal needs it to render anything at all.
drop policy if exists app_modules_read on app_modules;
create policy app_modules_read on app_modules for select to authenticated
using (true);

drop policy if exists app_modules_write on app_modules;
create policy app_modules_write on app_modules for all to authenticated
using (is_hr_admin() or is_sw_admin())
with check (is_hr_admin() or is_sw_admin());

-- Your own grants, or everybody's if you are the one handing them out.
drop policy if exists employee_modules_read on employee_modules;
create policy employee_modules_read on employee_modules for select to authenticated
using (employee_id = current_employee_id() or is_hr_admin() or is_sw_admin());

drop policy if exists employee_modules_write on employee_modules;
create policy employee_modules_write on employee_modules for all to authenticated
using (is_hr_admin() or is_sw_admin())
with check (is_hr_admin() or is_sw_admin());


-- ---------------------------------------------------------------------
-- What the portal asks for.
-- ---------------------------------------------------------------------
create or replace function my_modules()
returns setof app_modules
language sql stable security definer set search_path = public as $$
  select m.*
  from app_modules m
  join employee_modules em on em.module_code = m.code
  where m.is_active
    and em.employee_id = current_employee_id()
  order by m.sort_order, m.name
$$;

grant execute on function my_modules() to authenticated;

comment on function my_modules() is
  'The tiles to show the signed-in person. Offered, not permitted — each '
  'module still enforces its own access.';


-- ---------------------------------------------------------------------
-- Handing access out, and taking it back.
--
-- Through functions rather than raw inserts so that granted_by fills
-- itself in and the audit line is not something a caller can forget.
-- "Who gave this person BEMMP" is a question that gets asked.
-- ---------------------------------------------------------------------
create or replace function set_module_access(
  p_employee_id uuid,
  p_module_code text,
  p_granted     boolean
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR or SW Admin can change module access';
  end if;
  if not exists (select 1 from app_modules where code = p_module_code) then
    raise exception 'No module with code %', p_module_code;
  end if;
  if not exists (select 1 from employees where id = p_employee_id) then
    raise exception 'No such employee';
  end if;

  if p_granted then
    insert into employee_modules (employee_id, module_code, granted_by)
    values (p_employee_id, p_module_code, me)
    on conflict (employee_id, module_code) do nothing;
  else
    delete from employee_modules
    where employee_id = p_employee_id and module_code = p_module_code;
  end if;

  perform log_audit('employee', p_employee_id,
                    case when p_granted then 'module_granted' else 'module_revoked' end,
                    jsonb_build_object('module', p_module_code));
  return true;
end $$;

grant execute on function set_module_access(uuid, text, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- The three that exist today.
-- ---------------------------------------------------------------------
insert into app_modules (code, name, description, path, icon, sort_order) values
  ('kpi',   'KPI',
   'Monthly targets, your score, and your team''s.',
   '/kpi',   'ClipboardList', 10),
  ('spare', 'Spare Mapping',
   'Scan a QR tag to view or record warehouse spare details.',
   '/spare', 'QrCode', 20),
  ('bemmp', 'BEMMP Dashboard',
   'Biomedical equipment management and maintenance.',
   '/bemmp', 'Activity', 30)
on conflict (code) do nothing;

-- Everybody gets KPI. It is the one module that applies to every person
-- on the payroll — it is how they are appraised — so starting from
-- nothing would mean 1,148 grants before anyone could use what they
-- already use today. The other two start empty and are handed out.
insert into employee_modules (employee_id, module_code)
select e.id, 'kpi' from employees e where e.is_active
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  n      integer;
begin
  insert into employees (ecode, full_name, is_active)
  values ('ZZ-0057-PROBE', 'Probe', true) returning id into emp_id;

  -- A new person has nothing until somebody says otherwise.
  select count(*) into n from employee_modules where employee_id = emp_id;
  if n <> 0 then raise exception 'A new employee started with % module(s)', n; end if;

  -- Granting is idempotent: clicking twice is not two grants.
  insert into employee_modules (employee_id, module_code) values (emp_id, 'spare')
  on conflict do nothing;
  insert into employee_modules (employee_id, module_code) values (emp_id, 'spare')
  on conflict do nothing;
  select count(*) into n from employee_modules where employee_id = emp_id;
  if n <> 1 then raise exception 'Granting twice produced % rows', n; end if;

  -- An inactive module is not offered, whoever holds a grant for it.
  update app_modules set is_active = false where code = 'spare';
  if exists (
    select 1 from app_modules m
    join employee_modules em on em.module_code = m.code
    where em.employee_id = emp_id and m.is_active
  ) then raise exception 'A switched-off module was still offered'; end if;
  update app_modules set is_active = true where code = 'spare';

  -- Deleting a person takes their grants with them.
  delete from employees where id = emp_id;
  select count(*) into n from employee_modules where employee_id = emp_id;
  if n <> 0 then raise exception 'Grants outlived the employee'; end if;

  -- Nobody with a browser may hand themselves a module.
  if not (has_function_privilege('authenticated', 'set_module_access(uuid,text,boolean)', 'execute')) then
    raise exception 'HR cannot reach the grant function';
  end if;

  -- Everyone who is appraised can reach KPI.
  select count(*) into n from employees e
  where e.is_active
    and not exists (select 1 from employee_modules em
                    where em.employee_id = e.id and em.module_code = 'kpi');
  if n <> 0 then raise exception '% active employees cannot see the KPI tile', n; end if;

  raise notice '0057 self-test passed (% modules, % people on KPI)',
    (select count(*) from app_modules),
    (select count(*) from employee_modules where module_code = 'kpi');
end $$;
