-- =====================================================================
-- Cyrix KPI  ·  0012  ·  SW_Admin role, record deletion flow,
--                        and month-by-month editable targets
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SW_Admin — the software administrator.
--
-- Sees every employee record and every login's state, and can reset a
-- password. It CANNOT reveal a password: auth.users stores a bcrypt
-- hash, which is one-way by construction. No role, and no amount of
-- database access, can turn it back into the original text.
-- ---------------------------------------------------------------------
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles add constraint user_roles_role_check
  check (role in ('hr_admin', 'super_admin', 'sw_admin'));

create or replace function is_sw_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    join employees e on e.id = ur.employee_id
    where e.auth_user_id = auth.uid()
      and ur.role in ('sw_admin', 'super_admin')
  )
$$;

grant execute on function is_sw_admin() to authenticated;

-- SW_Admin reads everything, like HR.
drop policy if exists employees_read on employees;
create policy employees_read on employees for select to authenticated
using (
  auth_user_id = auth.uid()
  or reporting_manager_id = current_employee_id()
  or id = my_manager_id()
  or is_hr_admin()
  or is_sw_admin()
);

drop policy if exists employees_write on employees;
create policy employees_write on employees for all to authenticated
using (is_hr_admin() or is_sw_admin())
with check (is_hr_admin() or is_sw_admin());

drop policy if exists user_roles_read on user_roles;
create policy user_roles_read on user_roles for select to authenticated
using (employee_id = current_employee_id() or is_hr_admin() or is_sw_admin());

-- ---------------------------------------------------------------------
-- Login state, without ever exposing a password.
--
-- "Still on the issued default" is inferred from must_change_password,
-- not by comparing hashes — there is nothing to compare against.
-- ---------------------------------------------------------------------
create or replace view v_login_status as
select
  e.id                      as employee_id,
  e.ecode,
  e.full_name,
  e.designation,
  e.department,
  e.is_active,
  m.ecode                   as manager_ecode,
  m.full_name               as manager_name,
  u.email                   as login_email,
  (u.id is not null)        as has_login,
  e.must_change_password    as on_issued_default,
  u.created_at              as login_created_at,
  u.last_sign_in_at,
  u.updated_at              as password_changed_at,
  case
    when u.id is null then 'No login issued'
    when u.last_sign_in_at is null then 'Never signed in'
    when e.must_change_password then 'Using the issued default'
    else 'Set their own password'
  end                       as login_state
from employees e
left join auth.users u on u.id = e.auth_user_id
left join employees m on m.id = e.reporting_manager_id;

revoke all on v_login_status from public, anon;
grant select on v_login_status to authenticated;

-- The view reads auth.users, so it must run as owner; RLS on the base
-- table cannot filter it. Gate access inside a function instead.
create or replace function login_status()
returns setof v_login_status
language sql stable security definer set search_path = public as $$
  select * from v_login_status
  where is_sw_admin() or is_hr_admin()
$$;

grant execute on function login_status() to authenticated;


-- ---------------------------------------------------------------------
-- 2. Record deletion — a wrongly submitted month.
--
-- Two gates on purpose: the reporting manager knows whether the month is
-- genuinely wrong, and HR owns the appraisal record. Neither alone can
-- erase a scored month.
--
--   pending_manager -> pending_hr -> approved (row deleted)
--                   -> rejected at either stage
-- ---------------------------------------------------------------------
create table if not exists record_deletion_requests (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null references kpi_submissions(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  period_month     date not null,
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

create unique index if not exists idx_deletion_one_open
  on record_deletion_requests(submission_id)
  where status in ('pending_manager','pending_hr');

alter table record_deletion_requests enable row level security;

drop policy if exists deletion_read on record_deletion_requests;
create policy deletion_read on record_deletion_requests for select to authenticated
using (
  requested_by = current_employee_id()
  or employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin() or is_sw_admin()
);

grant select on record_deletion_requests to authenticated;


create or replace function request_record_deletion(
  p_submission_id uuid, p_reason text)
returns record_deletion_requests
language plpgsql security definer set search_path = public as $$
declare
  s kpi_submissions%rowtype;
  r record_deletion_requests%rowtype;
  me uuid := current_employee_id();
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;

  if not (s.employee_id = me or manages_employee(s.employee_id)
          or is_hr_admin() or is_sw_admin()) then
    raise exception 'You cannot request deletion of this record';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  insert into record_deletion_requests
    (submission_id, employee_id, period_month, requested_by, reason, manager_id)
  values (p_submission_id, s.employee_id, s.period_month, me, p_reason, s.manager_id)
  returning * into r;

  perform log_audit('kpi_submission', p_submission_id, 'deletion_requested',
                    jsonb_build_object('reason', p_reason));
  return r;
end $$;


create or replace function review_record_deletion(
  p_request_id uuid, p_approve boolean, p_note text default null)
returns record_deletion_requests
language plpgsql security definer set search_path = public as $$
declare
  r record_deletion_requests%rowtype;
  me uuid := current_employee_id();
begin
  select * into r from record_deletion_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;

  if r.status = 'pending_manager' then
    if not (manages_employee(r.employee_id) or is_hr_admin()) then
      raise exception 'Only the reporting manager can action this stage';
    end if;
    update record_deletion_requests
    set status = case when p_approve then 'pending_hr' else 'rejected' end,
        manager_id = me, manager_decided_at = now(), manager_note = p_note
    where id = p_request_id returning * into r;

  elsif r.status = 'pending_hr' then
    if not is_hr_admin() then
      raise exception 'Only HR can action the final stage';
    end if;
    update record_deletion_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        hr_id = me, hr_decided_at = now(), hr_note = p_note
    where id = p_request_id returning * into r;

    if p_approve then
      -- Log the numbers before they go, so the audit trail survives the row.
      perform log_audit('kpi_submission', r.submission_id, 'deleted_after_approval',
        (select jsonb_build_object(
           'period', s.period_month, 'employee', s.employee_id,
           'self_total', s.self_total_score, 'final_total', s.final_total_score,
           'reason', r.reason)
         from kpi_submissions s where s.id = r.submission_id));
      delete from kpi_submissions where id = r.submission_id;
    end if;

  else
    raise exception 'That request has already been decided';
  end if;

  return r;
end $$;

grant execute on function request_record_deletion(uuid, text) to authenticated;
grant execute on function review_record_deletion(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Targets can change month to month.
--
-- The guard froze target_value along with the rest of the definition.
-- A target legitimately moves — a monthly call quota is not the same in
-- April as in December — so it is now editable within the month, while
-- the weightage, KRA and scoring rule stay fixed. Changing a target
-- re-runs the scoring for that row.
-- ---------------------------------------------------------------------
create or replace function guard_submission_item_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s     kpi_submissions%rowtype;
  me    uuid;
  is_hr boolean;
begin
  if system_write_active() then return new; end if;
  if auth.uid() is null then return new; end if;

  select * into s from kpi_submissions where id = new.submission_id;
  me    := current_employee_id();
  is_hr := is_hr_admin() or is_sw_admin();

  if s.status = 'finalized' and not is_hr then
    raise exception 'This month is finalised and cannot be changed';
  end if;
  if is_hr then return new; end if;

  -- Weightage, KRA and the scoring rule are the agreed contract for the
  -- year. The target is the one part that may move month to month.
  if new.weightage is distinct from old.weightage
     or new.scoring_rule is distinct from old.scoring_rule
     or new.rule_params is distinct from old.rule_params
     or new.kra is distinct from old.kra then
    raise exception 'The KRA, weightage and scoring rule are fixed for the year';
  end if;

  if s.employee_id = me then
    if new.manager_achieved is distinct from old.manager_achieved
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager assessment';
    end if;
  elsif manages_employee(s.employee_id) then
    if new.self_achieved is distinct from old.self_achieved
       or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self assessment';
    end if;
  else
    raise exception 'Not permitted';
  end if;

  new.self_score    := old.self_score;
  new.manager_score := old.manager_score;
  new.final_score   := old.final_score;
  return new;
end $$;

-- A target change must recompute the row, so add it to the trigger's
-- watch list — it was deliberately excluded while targets were frozen.
drop trigger if exists trg_items_recompute on kpi_submission_items;
create trigger trg_items_recompute
  after insert or delete or update of
    self_achieved, manager_achieved, weightage, target_value, scoring_rule, rule_params
  on kpi_submission_items
  for each row execute function trg_recompute_submission();

grant update on kpi_submission_items to authenticated;
