-- =====================================================================
-- Cyrix KPI  ·  0006  ·  Row-Level Security
--
-- Visibility model:
--   TM         own record, own manager, own KPI + submissions
--   Manager    everything above, plus their DIRECT reports
--   HR admin   everything
--
-- Postgres RLS is row-level only, so *column*-level rules (a TM may
-- write self_achieved but never manager_achieved) are enforced by the
-- guard triggers at the bottom of this file.
-- =====================================================================

alter table employees              enable row level security;
alter table user_roles             enable row level security;
alter table job_roles              enable row level security;
alter table financial_years        enable row level security;
alter table scoring_rules          enable row level security;
alter table rating_scale           enable row level security;
alter table core_value_definitions enable row level security;
alter table app_settings           enable row level security;
alter table kpi_templates          enable row level security;
alter table kpi_template_items     enable row level security;
alter table kpi_assignments        enable row level security;
alter table kpi_assignment_items   enable row level security;
alter table kpi_submissions        enable row level security;
alter table kpi_submission_items   enable row level security;
alter table core_value_ratings     enable row level security;
alter table audit_log              enable row level security;

-- ---------------------------------------------------------------------
-- Reference data: everyone reads, HR writes.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['job_roles','financial_years','scoring_rules',
                           'rating_scale','core_value_definitions','app_settings']
  loop
    execute format('drop policy if exists %I_read on %I', t||'_read', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_hr_admin()) with check (is_hr_admin())', t||'_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
drop policy if exists employees_read on employees;
create policy employees_read on employees for select to authenticated
using (
  auth_user_id = auth.uid()                       -- myself
  or reporting_manager_id = current_employee_id() -- my direct reports
  or id = (select reporting_manager_id from employees me
           where me.auth_user_id = auth.uid())    -- my own manager
  or is_hr_admin()
);

-- A TM may correct nothing on their own record; only HR edits the org.
drop policy if exists employees_write on employees;
create policy employees_write on employees for all to authenticated
using (is_hr_admin()) with check (is_hr_admin());

drop policy if exists user_roles_read on user_roles;
create policy user_roles_read on user_roles for select to authenticated
using (employee_id = current_employee_id() or is_hr_admin());

drop policy if exists user_roles_write on user_roles;
create policy user_roles_write on user_roles for all to authenticated
using (is_hr_admin()) with check (is_hr_admin());

-- ---------------------------------------------------------------------
-- Templates -- readable by all (a TM starts from their role's template),
-- editable by HR only.
-- ---------------------------------------------------------------------
drop policy if exists templates_read on kpi_templates;
create policy templates_read on kpi_templates for select to authenticated using (true);
drop policy if exists templates_write on kpi_templates;
create policy templates_write on kpi_templates for all to authenticated
using (is_hr_admin()) with check (is_hr_admin());

drop policy if exists template_items_read on kpi_template_items;
create policy template_items_read on kpi_template_items for select to authenticated using (true);
drop policy if exists template_items_write on kpi_template_items;
create policy template_items_write on kpi_template_items for all to authenticated
using (is_hr_admin()) with check (is_hr_admin());

-- ---------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------
drop policy if exists assignments_read on kpi_assignments;
create policy assignments_read on kpi_assignments for select to authenticated
using (
  employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin()
);

-- A TM creates their own draft KPI (they upload the Excel themselves).
drop policy if exists assignments_insert on kpi_assignments;
create policy assignments_insert on kpi_assignments for insert to authenticated
with check (
  (employee_id = current_employee_id() and status = 'draft')
  or manages_employee(employee_id)
  or is_hr_admin()
);

-- Editable only while still a draft or after rejection. Once approved,
-- the structure is frozen for the year unless HR intervenes.
drop policy if exists assignments_update on kpi_assignments;
create policy assignments_update on kpi_assignments for update to authenticated
using (
  (employee_id = current_employee_id() and status in ('draft','rejected'))
  or manages_employee(employee_id)
  or is_hr_admin()
);

drop policy if exists assignments_delete on kpi_assignments;
create policy assignments_delete on kpi_assignments for delete to authenticated
using (
  (employee_id = current_employee_id() and status in ('draft','rejected'))
  or is_hr_admin()
);

-- Items inherit their parent's rules.
drop policy if exists assignment_items_read on kpi_assignment_items;
create policy assignment_items_read on kpi_assignment_items for select to authenticated
using (exists (
  select 1 from kpi_assignments a where a.id = assignment_id
    and (a.employee_id = current_employee_id()
         or manages_employee(a.employee_id) or is_hr_admin())
));

drop policy if exists assignment_items_write on kpi_assignment_items;
create policy assignment_items_write on kpi_assignment_items for all to authenticated
using (exists (
  select 1 from kpi_assignments a where a.id = assignment_id
    and ((a.employee_id = current_employee_id() and a.status in ('draft','rejected'))
         or (manages_employee(a.employee_id) and a.status in ('draft','rejected','pending_approval'))
         or is_hr_admin())
))
with check (exists (
  select 1 from kpi_assignments a where a.id = assignment_id
    and ((a.employee_id = current_employee_id() and a.status in ('draft','rejected'))
         or (manages_employee(a.employee_id) and a.status in ('draft','rejected','pending_approval'))
         or is_hr_admin())
));

-- ---------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------
drop policy if exists submissions_read on kpi_submissions;
create policy submissions_read on kpi_submissions for select to authenticated
using (
  employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin()
);

-- Header edits are limited to the remark fields; the guard trigger below
-- stops anyone rewriting scores or status directly. Status transitions
-- go exclusively through the workflow RPCs in 0005.
drop policy if exists submissions_update on kpi_submissions;
create policy submissions_update on kpi_submissions for update to authenticated
using (
  (employee_id = current_employee_id() and status in ('draft','returned'))
  or (manages_employee(employee_id) and status in ('submitted','scored'))
  or is_hr_admin()
);

drop policy if exists submission_items_read on kpi_submission_items;
create policy submission_items_read on kpi_submission_items for select to authenticated
using (exists (
  select 1 from kpi_submissions s where s.id = submission_id
    and (s.employee_id = current_employee_id()
         or manages_employee(s.employee_id) or is_hr_admin())
));

drop policy if exists submission_items_update on kpi_submission_items;
create policy submission_items_update on kpi_submission_items for update to authenticated
using (exists (
  select 1 from kpi_submissions s where s.id = submission_id
    and s.status <> 'finalized'
    and ((s.employee_id = current_employee_id() and s.status in ('draft','returned'))
         or (manages_employee(s.employee_id) and s.status in ('submitted','scored'))
         or is_hr_admin())
));

drop policy if exists core_ratings_read on core_value_ratings;
create policy core_ratings_read on core_value_ratings for select to authenticated
using (exists (
  select 1 from kpi_submissions s where s.id = submission_id
    and (s.employee_id = current_employee_id()
         or manages_employee(s.employee_id) or is_hr_admin())
));

drop policy if exists core_ratings_update on core_value_ratings;
create policy core_ratings_update on core_value_ratings for update to authenticated
using (exists (
  select 1 from kpi_submissions s where s.id = submission_id
    and s.status <> 'finalized'
    and ((s.employee_id = current_employee_id() and s.status in ('draft','returned'))
         or (manages_employee(s.employee_id) and s.status in ('submitted','scored'))
         or is_hr_admin())
));

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select to authenticated
using (actor_id = current_employee_id() or is_hr_admin());


-- =====================================================================
-- Column guards -- the part RLS cannot express.
--
-- Without these, a TM could PATCH manager_achieved on their own row
-- through PostgREST and score themselves.
-- =====================================================================

create or replace function guard_submission_item_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s      kpi_submissions%rowtype;
  me     uuid := current_employee_id();
  is_hr  boolean := is_hr_admin();
begin
  select * into s from kpi_submissions where id = new.submission_id;

  -- Nobody edits a locked month.
  if s.status = 'finalized' and not is_hr then
    raise exception 'This month is finalised and cannot be changed';
  end if;

  if is_hr then
    return new;
  end if;

  -- The TM: self columns only.
  if s.employee_id = me then
    if new.manager_achieved is distinct from old.manager_achieved
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager assessment';
    end if;
    if new.weightage is distinct from old.weightage
       or new.target_value is distinct from old.target_value
       or new.scoring_rule is distinct from old.scoring_rule
       or new.rule_params is distinct from old.rule_params
       or new.kra is distinct from old.kra then
      raise exception 'The KPI definition is fixed for the month and cannot be edited here';
    end if;

  -- The manager: manager columns only.
  elsif manages_employee(s.employee_id) then
    if new.self_achieved is distinct from old.self_achieved
       or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self assessment';
    end if;
    if new.weightage is distinct from old.weightage
       or new.target_value is distinct from old.target_value
       or new.scoring_rule is distinct from old.scoring_rule
       or new.rule_params is distinct from old.rule_params
       or new.kra is distinct from old.kra then
      raise exception 'The KPI definition is fixed for the month and cannot be edited here';
    end if;
  else
    raise exception 'Not permitted';
  end if;

  -- Scores are always derived, never supplied by a client.
  new.self_score    := old.self_score;
  new.manager_score := old.manager_score;
  new.final_score   := old.final_score;

  return new;
end $$;

drop trigger if exists trg_guard_submission_items on kpi_submission_items;
create trigger trg_guard_submission_items
  before update on kpi_submission_items
  for each row execute function guard_submission_item_columns();


create or replace function guard_core_rating_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s     kpi_submissions%rowtype;
  me    uuid := current_employee_id();
begin
  select * into s from kpi_submissions where id = new.submission_id;
  if is_hr_admin() then return new; end if;

  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager rating';
    end if;
  elsif manages_employee(s.employee_id) then
    if new.self_rating is distinct from old.self_rating then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_core_ratings on core_value_ratings;
create trigger trg_guard_core_ratings
  before update on core_value_ratings
  for each row execute function guard_core_rating_columns();


-- Header: remarks are free, everything else is RPC-driven.
create or replace function guard_submission_header()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_hr_admin() then return new; end if;

  if new.status is distinct from old.status then
    raise exception 'Status changes must go through the submit / score / finalise actions';
  end if;
  if new.self_total_score  is distinct from old.self_total_score
     or new.mgr_total_score   is distinct from old.mgr_total_score
     or new.final_total_score is distinct from old.final_total_score then
    raise exception 'Scores are calculated and cannot be set directly';
  end if;

  if old.employee_id = current_employee_id() then
    if new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager remarks';
    end if;
  elsif manages_employee(old.employee_id) then
    if new.employee_remarks is distinct from old.employee_remarks then
      raise exception 'You cannot edit the team member''s remarks';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_submission_header on kpi_submissions;
create trigger trg_guard_submission_header
  before update on kpi_submissions
  for each row execute function guard_submission_header();


-- ---------------------------------------------------------------------
-- Grants. Table privileges still gate everything RLS then filters.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on kpi_assignments, kpi_assignment_items to authenticated;
grant update on kpi_submissions, kpi_submission_items, core_value_ratings to authenticated;
grant execute on all functions in schema public to authenticated;
