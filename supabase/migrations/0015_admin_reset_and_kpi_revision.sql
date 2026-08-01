-- =====================================================================
-- Cyrix KPI  ·  0015  ·  Admin password reset, and revising a locked KPI
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Reset a single account back to its employee code.
--
-- Until now this was command line only, on the grounds that the reset
-- needs the service-role key. It does not: the hash can be written from
-- inside the database by a definer function, so no key has to reach a
-- browser. The gate is the caller's role, checked here rather than
-- trusted from the client.
--
-- This still cannot reveal a password. It overwrites one.
-- ---------------------------------------------------------------------
create or replace function admin_reset_password(p_employee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  emp          record;
  force_change boolean;
  actor        uuid := current_employee_id();
begin
  if not (is_sw_admin() or is_hr_admin()) then
    raise exception 'Only SW Admin or HR can reset a password';
  end if;

  select e.id, e.ecode, e.full_name, e.auth_user_id into emp
  from employees e where e.id = p_employee_id;

  if not found then raise exception 'Employee not found'; end if;
  if emp.auth_user_id is null then
    raise exception 'That employee has no login yet, so there is nothing to reset';
  end if;

  select coalesce(value::text::boolean, false) into force_change
  from app_settings where key = 'force_password_change';

  -- gen_salt('bf', 10) produces the same $2a$10$ format GoTrue writes, so
  -- the new password validates normally at the next sign-in.
  update auth.users
  set encrypted_password = extensions.crypt(
        upper(emp.ecode), extensions.gen_salt('bf', 10)),
      updated_at = now()
  where id = emp.auth_user_id;

  update employees
  set password_is_default   = true,
      must_change_password  = coalesce(force_change, false)
  where id = emp.id;

  insert into audit_log (actor_id, entity_type, entity_id, action, details)
  values (actor, 'employee', emp.id, 'admin_password_reset',
          jsonb_build_object('ecode', upper(emp.ecode)));

  return jsonb_build_object(
    'ok', true, 'ecode', upper(emp.ecode), 'full_name', emp.full_name);
end $$;

comment on function admin_reset_password(uuid) is
  'Sets an account password back to its employee code. SW Admin or HR '
  'only. Writes a bcrypt hash — it never reads one, because it cannot.';

revoke all on function admin_reset_password(uuid) from public, anon;
grant execute on function admin_reset_password(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Revising a KPI that is already approved.
--
-- An approved KPI is the agreed contract for the year, so the guards
-- freeze the KRA, weightage and scoring rule. That is right for the
-- ordinary case and wrong for one real one: somebody changes job role in
-- September and is now being measured against work they no longer do.
--
-- The same two gates as a deletion, and for the same reason — the
-- reporting manager knows whether the change is genuine, HR owns the
-- appraisal record:
--
--   pending_manager -> pending_hr -> approved (assignment unlocked)
--                   -> rejected at either stage
--
-- On approval the assignment goes back to 'draft'. It does NOT touch
-- history: kpi_submissions carry their own frozen copy of the definition
-- they were assessed against, which is the whole point of the snapshot.
-- April to August keep the old KPI and the scores they earned; the new
-- one applies from the next month opened.
--
-- Only one live assignment per person per year exists (see
-- idx_assignment_one_live), so this reuses the row rather than creating a
-- second one. The previous definition is written to the audit log before
-- it can be edited.
-- ---------------------------------------------------------------------
create table if not exists kpi_revision_requests (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references kpi_assignments(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  financial_year   text not null,
  requested_by     uuid not null references employees(id) on delete cascade,
  reason           text not null,

  status           text not null default 'pending_manager'
                     check (status in ('pending_manager','pending_hr','approved','rejected')),

  manager_id       uuid references employees(id) on delete set null,
  manager_decided_at timestamptz,
  manager_note     text,

  hr_id            uuid references employees(id) on delete set null,
  hr_decided_at    timestamptz,
  hr_note          text,

  created_at       timestamptz not null default now()
);

create unique index if not exists idx_revision_one_open
  on kpi_revision_requests(assignment_id)
  where status in ('pending_manager','pending_hr');

create index if not exists idx_revision_employee
  on kpi_revision_requests(employee_id, financial_year);

alter table kpi_revision_requests enable row level security;

drop policy if exists revision_read on kpi_revision_requests;
create policy revision_read on kpi_revision_requests for select to authenticated
using (
  requested_by = current_employee_id()
  or employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin() or is_sw_admin()
);

grant select on kpi_revision_requests to authenticated;


create or replace function request_kpi_revision(
  p_assignment_id uuid, p_reason text)
returns kpi_revision_requests
language plpgsql security definer set search_path = public as $$
declare
  a  kpi_assignments%rowtype;
  r  kpi_revision_requests%rowtype;
  me uuid := current_employee_id();
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'KPI not found'; end if;

  if not (a.employee_id = me or manages_employee(a.employee_id)
          or is_hr_admin()) then
    raise exception 'You cannot request a revision of this KPI';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  -- Only a locked KPI needs this route. A draft or rejected one is
  -- already editable, and sending it round two approvers would be theatre.
  if a.status <> 'active' then
    raise exception 'This KPI is already open for editing (current: %)', a.status;
  end if;

  insert into kpi_revision_requests
    (assignment_id, employee_id, financial_year, requested_by, reason, manager_id)
  values (p_assignment_id, a.employee_id, a.financial_year, me,
          p_reason, (select reporting_manager_id from employees where id = a.employee_id))
  returning * into r;

  perform log_audit('kpi_assignment', p_assignment_id, 'revision_requested',
                    jsonb_build_object('reason', p_reason));
  return r;
end $$;


create or replace function review_kpi_revision(
  p_request_id uuid, p_approve boolean, p_note text default null)
returns kpi_revision_requests
language plpgsql security definer set search_path = public as $$
declare
  r  kpi_revision_requests%rowtype;
  me uuid := current_employee_id();
begin
  select * into r from kpi_revision_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;

  if r.status = 'pending_manager' then
    if not (manages_employee(r.employee_id) or is_hr_admin()) then
      raise exception 'Only the reporting manager can action this stage';
    end if;
    update kpi_revision_requests
    set status = case when p_approve then 'pending_hr' else 'rejected' end,
        manager_id = me, manager_decided_at = now(), manager_note = p_note
    where id = p_request_id returning * into r;

  elsif r.status = 'pending_hr' then
    if not is_hr_admin() then
      raise exception 'Only HR can action the final stage';
    end if;
    update kpi_revision_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        hr_id = me, hr_decided_at = now(), hr_note = p_note
    where id = p_request_id returning * into r;

    if p_approve then
      -- Record what the KPI was before anyone can change it. Months
      -- already assessed keep their own frozen copy regardless; this is
      -- so the annual definition itself has a before-and-after.
      perform log_audit('kpi_assignment', r.assignment_id, 'revision_approved',
        (select jsonb_build_object(
           'reason', r.reason,
           'financial_year', a.financial_year,
           'previous_items', coalesce(jsonb_agg(jsonb_build_object(
             'kra', i.kra, 'weightage', i.weightage,
             'target_value', i.target_value, 'scoring_rule', i.scoring_rule
           ) order by i.sort_order), '[]'::jsonb))
         from kpi_assignments a
         left join kpi_assignment_items i on i.assignment_id = a.id
         where a.id = r.assignment_id
         group by a.financial_year));

      update kpi_assignments
      set status = 'draft', approved_at = null, approved_by = null
      where id = r.assignment_id;
    end if;

  else
    raise exception 'That request has already been decided';
  end if;

  return r;
end $$;

grant execute on function request_kpi_revision(uuid, text) to authenticated;
grant execute on function review_kpi_revision(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. One count for the nav badge.
--
-- A manager had no way to reach either queue: the Deletions screen was
-- only ever linked from the HR and SW Admin navs, so a request that
-- correctly reached 'pending_manager' sat where the manager could not
-- see it. The link is now in their nav, and this is what numbers it.
-- ---------------------------------------------------------------------
create or replace function my_pending_record_requests()
returns integer
language sql stable security definer set search_path = public as $$
  select (
    select count(*) from record_deletion_requests r
    where (r.status = 'pending_manager' and manages_employee(r.employee_id))
       or (r.status = 'pending_hr' and is_hr_admin())
  ) + (
    select count(*) from kpi_revision_requests r
    where (r.status = 'pending_manager' and manages_employee(r.employee_id))
       or (r.status = 'pending_hr' and is_hr_admin())
  )
$$;

grant execute on function my_pending_record_requests() to authenticated;


-- ---------------------------------------------------------------------
-- Self-test. These run inside the migration transaction and roll back,
-- so they prove the rules hold without leaving anything behind.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- The open-request index has to be partial, or a rejected request would
  -- block anyone from ever raising a second one for the same KPI.
  select count(*) into n
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  where c.relname = 'idx_revision_one_open' and i.indpred is not null;
  if n <> 1 then
    raise exception 'idx_revision_one_open must be a partial index';
  end if;

  -- A revision must only be reachable from 'active'. Anything else is
  -- already editable and the two approvals would mean nothing.
  select count(*) into n
  from pg_proc p
  where p.proname = 'request_kpi_revision'
    and pg_get_functiondef(p.oid) like '%a.status <> ''active''%';
  if n <> 1 then
    raise exception 'request_kpi_revision must refuse a KPI that is not active';
  end if;

  raise notice '0015 self-test passed';
end $$;
