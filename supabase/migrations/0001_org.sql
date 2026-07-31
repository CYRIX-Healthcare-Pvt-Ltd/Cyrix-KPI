-- =====================================================================
-- Cyrix KPI  ·  0001  ·  Organisation: employees, job roles, app roles
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Job roles.  Cyrix has several (Service Engineer, BD, etc.) and each
-- one can carry a different KPI template with different scoring maths.
-- ---------------------------------------------------------------------
create table if not exists job_roles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Employees.  `ecode` is the login id.  `auth_user_id` links to the
-- Supabase Auth user created as <ecode>@cyrix.local.
--
-- reporting_manager_id is self-referential: an employee with direct
-- reports IS a manager. There is no separate "manager" table, so the
-- same person can submit their own KPI upward and score their team.
-- ---------------------------------------------------------------------
create table if not exists employees (
  id                    uuid primary key default gen_random_uuid(),
  ecode                 text not null unique,
  full_name             text not null,
  work_email            text,
  designation           text,
  department            text,
  location              text,
  job_role_id           uuid references job_roles(id) on delete set null,
  reporting_manager_id  uuid references employees(id) on delete set null,
  date_of_joining       date,
  is_active             boolean not null default true,

  auth_user_id          uuid unique,          -- -> auth.users.id
  must_change_password  boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- an employee cannot report to themselves
  constraint employees_no_self_manager check (id <> reporting_manager_id)
);

create index if not exists idx_employees_manager on employees(reporting_manager_id);
create index if not exists idx_employees_auth    on employees(auth_user_id);
create index if not exists idx_employees_ecode   on employees(lower(ecode));

-- ---------------------------------------------------------------------
-- Elevated application roles. Plain employees need no row here;
-- "is a manager" is derived from having direct reports.
-- ---------------------------------------------------------------------
create table if not exists user_roles (
  employee_id uuid not null references employees(id) on delete cascade,
  role        text not null check (role in ('hr_admin','super_admin')),
  granted_at  timestamptz not null default now(),
  primary key (employee_id, role)
);

-- ---------------------------------------------------------------------
-- Financial years.  Cyrix runs Apr -> Mar, matching the template
-- ("Apr-26" ... "Mar-27" = FY 2026-27).
-- ---------------------------------------------------------------------
create table if not exists financial_years (
  code        text primary key,          -- '2026-27'
  starts_on   date not null,             -- 2026-04-01
  ends_on     date not null,             -- 2027-03-31
  is_current  boolean not null default false
);

-- only one current FY at a time
create unique index if not exists idx_fy_single_current
  on financial_years((is_current)) where is_current;

-- ---------------------------------------------------------------------
-- Audit trail. Appraisal and PIP decisions ride on these numbers, so
-- every state change on a submission or assignment gets recorded.
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id           bigserial primary key,
  actor_id     uuid references employees(id) on delete set null,
  entity_type  text not null,
  entity_id    uuid,
  action       text not null,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_audit_entity on audit_log(entity_type, entity_id);
create index if not exists idx_audit_actor  on audit_log(actor_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at trigger helper (reused by later migrations)
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_employees_updated on employees;
create trigger trg_employees_updated before update on employees
  for each row execute function set_updated_at();
