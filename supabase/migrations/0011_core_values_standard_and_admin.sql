-- =====================================================================
-- Cyrix KPI  ·  0011  ·  Standard core values, removal requests,
--                        and the reporting layer for HR and managers
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Core values are identical for every team member.
--
-- They stay a normal row in kpi_assignment_items so scoring, snapshots
-- and history all work unchanged — but nobody edits them per person any
-- more. The system stamps the standard row on, from one definition here.
-- ---------------------------------------------------------------------
insert into app_settings (key, value, description) values
  ('core_values_row',
   jsonb_build_object(
     'kra', 'Customer Delight',
     'kpi_description',
       'Delivers a positive customer experience through responsiveness, accountability, '
       'strong communication, and continuous improvement, while building trust and '
       'effective relationships.',
     'weightage', 20,
     'target_value', 100,
     'scoring_rule', 'rating_scale'),
   'The single core-values KPI row applied to everyone. Team members define only '
   'their Job Role rows; this 20% block is standard and added automatically.')
on conflict (key) do nothing;


create or replace function apply_standard_core_values(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      jsonb;
  next_ord int;
begin
  select value into cfg from app_settings where key = 'core_values_row';
  if cfg is null then
    raise exception 'No core_values_row configured in app_settings';
  end if;

  delete from kpi_assignment_items
  where assignment_id = p_assignment_id and section = 'core_values';

  select coalesce(max(sort_order), 0) + 1 into next_ord
  from kpi_assignment_items where assignment_id = p_assignment_id;

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  values (
    p_assignment_id, 'core_values',
    cfg->>'kra', cfg->>'kpi_description',
    (cfg->>'weightage')::numeric, (cfg->>'target_value')::numeric, 'score',
    cfg->>'scoring_rule', '{}'::jsonb, next_ord);
end $$;

comment on function apply_standard_core_values(uuid) is
  'Replaces an assignment''s core-values rows with the single standard one. '
  'Called on save and again on submit, so a KPI cannot reach a manager '
  'without the 20% block being exactly right.';

grant execute on function apply_standard_core_values(uuid) to authenticated;


-- Stamp it on at submit time too, so the rule holds even if a client skips it.
create or replace function submit_assignment_for_approval(p_assignment_id uuid)
returns kpi_assignments
language plpgsql security definer set search_path = public as $$
declare
  a  kpi_assignments%rowtype;
  v  record;
  me uuid := current_employee_id();
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.employee_id <> me and not is_hr_admin() then
    raise exception 'You can only submit your own KPI for approval';
  end if;
  if a.status not in ('draft','rejected') then
    raise exception 'Only a draft or rejected KPI can be submitted (current: %)', a.status;
  end if;

  perform apply_standard_core_values(p_assignment_id);

  select * into v from validate_assignment(p_assignment_id);
  if not v.ok then raise exception '%', v.message; end if;

  update kpi_assignments
  set status = 'pending_approval', submitted_at = now(), submitted_by = me,
      rejection_reason = null
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'submitted_for_approval', '{}'::jsonb);
  return a;
end $$;


-- Backfill: make every existing assignment match the standard.
do $$
declare r record;
begin
  for r in select id from kpi_assignments where status <> 'archived' loop
    perform apply_standard_core_values(r.id);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2. Removal requests — a manager flags a leaver, HR actions it.
--    Managers must not be able to deactivate people themselves.
-- ---------------------------------------------------------------------
create table if not exists tm_removal_requests (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  requested_by  uuid not null references employees(id) on delete cascade,
  reason        text not null,
  last_working_day date,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  reviewed_by   uuid references employees(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now()
);

create unique index if not exists idx_removal_one_pending
  on tm_removal_requests(employee_id) where status = 'pending';

alter table tm_removal_requests enable row level security;

drop policy if exists removal_read on tm_removal_requests;
create policy removal_read on tm_removal_requests for select to authenticated
using (requested_by = current_employee_id()
       or manages_employee(employee_id)
       or is_hr_admin());

drop policy if exists removal_insert on tm_removal_requests;
create policy removal_insert on tm_removal_requests for insert to authenticated
with check (manages_employee(employee_id) or is_hr_admin());

grant insert on tm_removal_requests to authenticated;


create or replace function request_tm_removal(
  p_employee_id uuid, p_reason text, p_last_working_day date default null)
returns tm_removal_requests
language plpgsql security definer set search_path = public as $$
declare r tm_removal_requests%rowtype;
begin
  if not (manages_employee(p_employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager can request this removal';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  insert into tm_removal_requests (employee_id, requested_by, reason, last_working_day)
  values (p_employee_id, current_employee_id(), p_reason, p_last_working_day)
  returning * into r;

  perform log_audit('employee', p_employee_id, 'removal_requested',
                    jsonb_build_object('reason', p_reason));
  return r;
end $$;


create or replace function review_tm_removal(
  p_request_id uuid, p_approve boolean, p_note text default null)
returns tm_removal_requests
language plpgsql security definer set search_path = public as $$
declare r tm_removal_requests%rowtype;
begin
  if not is_hr_admin() then
    raise exception 'Only HR can action a removal request';
  end if;

  update tm_removal_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = current_employee_id(), reviewed_at = now(), review_note = p_note
  where id = p_request_id and status = 'pending'
  returning * into r;
  if not found then raise exception 'That request is not pending'; end if;

  if p_approve then
    -- Deactivate rather than delete: the appraisal history has to survive.
    update employees set is_active = false where id = r.employee_id;
    -- Anyone reporting to them is left dangling; HR reassigns explicitly.
    update employees set reporting_manager_id = null
    where reporting_manager_id = r.employee_id;
  end if;

  perform log_audit('employee', r.employee_id,
                    case when p_approve then 'removal_approved' else 'removal_rejected' end,
                    jsonb_build_object('note', p_note));
  return r;
end $$;

grant execute on function request_tm_removal(uuid, text, date) to authenticated;
grant execute on function review_tm_removal(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Reporting views
--
-- Score bands follow the same scale people already rate against, so
-- "weak" means genuinely below Good, not merely the lowest number:
--    >= 90 Excellent · >= 80 Very Good · >= 60 Good
--    >= 40 Satisfactory · < 40 Poor
-- ---------------------------------------------------------------------
create or replace function score_band(p_pct numeric)
returns text language sql immutable as $$
  select case
    when p_pct is null then null
    when p_pct >= 90 then 'Excellent'
    when p_pct >= 80 then 'Very Good'
    when p_pct >= 60 then 'Good'
    when p_pct >= 40 then 'Satisfactory'
    else 'Poor'
  end
$$;

-- Per-row attainment as a percentage of that row's weightage. This is
-- what makes "weak" comparable across rows worth 10% and 35%.
create or replace view v_kra_attainment as
select
  s.employee_id,
  s.financial_year,
  s.period_month,
  s.status,
  i.section,
  i.kra,
  i.weightage,
  coalesce(i.final_score, i.self_score)                              as score,
  case when i.weightage > 0
       then round(coalesce(i.final_score, i.self_score) / i.weightage * 100, 2)
  end                                                                as attainment_pct,
  score_band(case when i.weightage > 0
                  then coalesce(i.final_score, i.self_score) / i.weightage * 100 end) as band
from kpi_submissions s
join kpi_submission_items i on i.submission_id = s.id
where s.status in ('scored','finalized');


-- Where each person is genuinely weak, averaged over the year.
create or replace view v_employee_weak_areas as
select
  employee_id,
  financial_year,
  section,
  kra,
  count(*)                              as months,
  round(avg(attainment_pct), 1)         as avg_attainment_pct,
  score_band(avg(attainment_pct))       as band
from v_kra_attainment
where attainment_pct is not null
group by employee_id, financial_year, section, kra;


-- Manager turnaround: how long a submitted month sits before it is
-- scored, and before it is finalised.
create or replace view v_manager_tat as
select
  s.manager_id,
  m.ecode                                as manager_ecode,
  m.full_name                            as manager_name,
  s.financial_year,
  count(*)                               as months_handled,
  round(avg(extract(epoch from (s.manager_scored_at - s.self_submitted_at)) / 86400)::numeric, 1)
                                         as avg_days_to_score,
  round(avg(extract(epoch from (s.finalized_at    - s.self_submitted_at)) / 86400)::numeric, 1)
                                         as avg_days_to_finalize,
  count(*) filter (where s.status = 'submitted')  as still_awaiting_score,
  max(extract(epoch from (now() - s.self_submitted_at)) / 86400)::numeric(10,1)
                                         as oldest_pending_days
from kpi_submissions s
left join employees m on m.id = s.manager_id
where s.self_submitted_at is not null
group by s.manager_id, m.ecode, m.full_name, s.financial_year;


-- One row per active employee: where their KPI and current month stand.
create or replace view v_org_kpi_status as
select
  e.id                       as employee_id,
  e.ecode,
  e.full_name,
  e.designation,
  e.department,
  e.location,
  e.reporting_manager_id,
  m.ecode                    as manager_ecode,
  m.full_name                as manager_name,
  a.financial_year,
  coalesce(a.status, 'not_set_up')     as kpi_status,
  a.approved_at,
  (select count(*) from kpi_submissions s
    where s.employee_id = e.id and s.financial_year = a.financial_year
      and s.status in ('scored','finalized'))          as months_scored,
  (select count(*) from kpi_submissions s
    where s.employee_id = e.id and s.status = 'submitted') as months_awaiting_manager,
  (select round(avg(s.final_total_score), 2) from kpi_submissions s
    where s.employee_id = e.id and s.financial_year = a.financial_year
      and s.status in ('scored','finalized'))          as avg_score
from employees e
left join employees m on m.id = e.reporting_manager_id
left join kpi_assignments a on a.employee_id = e.id
                           and a.status in ('draft','pending_approval','active','rejected')
where e.is_active;


-- How complete each manager's team is, for the HR dashboard.
create or replace view v_manager_completion as
select
  m.id                                                   as manager_id,
  m.ecode                                                as manager_ecode,
  m.full_name                                            as manager_name,
  m.department,
  count(t.employee_id)                                   as team_size,
  count(*) filter (where t.kpi_status = 'active')        as kpi_approved,
  count(*) filter (where t.kpi_status = 'pending_approval') as kpi_awaiting_approval,
  count(*) filter (where t.kpi_status = 'not_set_up')    as kpi_not_set_up,
  sum(t.months_awaiting_manager)                         as months_awaiting_score,
  round(avg(t.avg_score), 2)                             as team_avg_score
from employees m
join v_org_kpi_status t on t.reporting_manager_id = m.id
where m.is_active
group by m.id, m.ecode, m.full_name, m.department;

grant select on v_kra_attainment, v_employee_weak_areas, v_manager_tat,
                v_org_kpi_status, v_manager_completion to authenticated;
