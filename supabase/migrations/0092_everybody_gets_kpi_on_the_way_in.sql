-- =====================================================================
-- Cyrix KPI  ·  0092  ·  Everybody gets KPI on the way in
--
-- A new employee signed in to the portal and was told "No modules have
-- been assigned to you yet. Ask HR to add them." -- by the same HR who
-- had just added them, on the screen that was supposed to have done it.
--
-- 1,148 of the 1,150 active employees have KPI, and all 1,148 got it
-- from the import that seeded them. Nothing in the app has ever granted
-- one, so every person added through Add employee or Bulk import since
-- has arrived with none.
--
-- KPI is not optional in the way the other two are. Spare Mapping and
-- BEMMP are tools some jobs use; KPI is how everybody is appraised, so
-- the answer to "which modules does a new employee get" starts at one
-- rather than at zero.
--
-- A trigger rather than a line in the add form, because there are three
-- ways in -- the form, the bulk import, and whatever script is written
-- next -- and only the table sees all of them. The one call site I could
-- patch is the one that would go on being right while the other two
-- quietly did not.
-- =====================================================================

create or replace function public.grant_default_modules()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only if KPI is switched on. A company that retires the module should
  -- not have new joiners handed a tile to a module nobody uses.
  insert into employee_modules (employee_id, module_code)
  select new.id, 'kpi'
  where exists (select 1 from app_modules where code = 'kpi' and is_active)
  on conflict (employee_id, module_code) do nothing;

  return new;
end $$;

drop trigger if exists trg_employees_default_modules on employees;
create trigger trg_employees_default_modules
  after insert on employees
  for each row execute function grant_default_modules();

comment on function public.grant_default_modules() is
  'Grants the KPI module to every new employee. KPI is how everybody is '
  'appraised, so it is not opt-in the way Spare and BEMMP are.';


-- ---------------------------------------------------------------------
-- The people who arrived before the trigger did.
--
-- Active only. Somebody deactivated has no reason to be handed a module
-- now, and granting one would put them back on a list they were taken
-- off deliberately.
-- ---------------------------------------------------------------------
insert into employee_modules (employee_id, module_code)
select e.id, 'kpi'
from employees e
where e.is_active
  and exists (select 1 from app_modules where code = 'kpi' and is_active)
on conflict (employee_id, module_code) do nothing;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp_id uuid;
  n int;
begin
  -- Nobody active is left without it.
  select count(*) into n
  from employees e
  where e.is_active
    and not exists (
      select 1 from employee_modules m
      where m.employee_id = e.id and m.module_code = 'kpi');
  if n > 0 then
    raise exception '% active employee(s) still have no KPI module', n;
  end if;

  -- And a new one gets it without anybody asking.
  insert into employees (ecode, full_name, is_active)
  values ('ZZ0092', 'Probe', true) returning id into emp_id;

  if not exists (
    select 1 from employee_modules
    where employee_id = emp_id and module_code = 'kpi'
  ) then
    raise exception 'A new employee did not get the KPI module';
  end if;

  -- Exactly one row, not one per anything.
  select count(*) into n from employee_modules where employee_id = emp_id;
  if n <> 1 then
    raise exception 'A new employee got % module rows, expected 1', n;
  end if;

  -- The other two stay opt-in: this grants KPI and nothing else.
  if exists (
    select 1 from employee_modules
    where employee_id = emp_id and module_code <> 'kpi'
  ) then
    raise exception 'A new employee was handed a module that should be opt-in';
  end if;

  raise notice '0092 self-test passed (KPI granted on insert, nobody active left without it)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $$;
