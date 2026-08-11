-- =====================================================================
-- Cyrix KPI  ·  0043  ·  When a KPI starts
--
-- Somebody who joined in June was being chased for April and May. The
-- financial year has twelve months in it, so every report generated
-- twelve rows per person and marked the ones before they arrived as
-- outstanding — work that was never theirs to do.
--
-- So an assignment now says which month it begins. Everything that
-- enumerates months for a person reads it.
--
-- NULL means "nobody has said yet", and it is deliberately not
-- backfilled to April. A default would be indistinguishable from an
-- answer, and the whole point is to collect the answer from the people
-- who know it — the team member sets it, the manager can correct it
-- while approving. Until then the views behave exactly as they did, so
-- this migration changes no numbers on its own.
-- =====================================================================

alter table kpi_assignments
  add column if not exists starts_from date;

alter table kpi_assignments
  drop constraint if exists kpi_assignments_starts_from_month;
alter table kpi_assignments
  add constraint kpi_assignments_starts_from_month
  check (starts_from is null or starts_from = date_trunc('month', starts_from)::date);

comment on column kpi_assignments.starts_from is
  'First month this KPI is expected for. Null until somebody says. '
  'Months before it are not this person''s to submit and are left out '
  'of every count.';


-- ---------------------------------------------------------------------
-- Setting it.
--
-- Separate from the assignment''s other columns because the rules are
-- different: the rows are frozen once approved, but this stays fixable
-- afterwards. It has to be — every KPI in the system predates this
-- column, and the answers have to be collected from people whose KPI is
-- already active.
--
-- The one thing it may never do is move past a month somebody has
-- already been assessed on. That would orphan a real submission behind
-- a date saying it should not exist.
-- ---------------------------------------------------------------------
create or replace function set_kpi_start(
  p_assignment_id uuid,
  p_starts_from   date
)
returns kpi_assignments
language plpgsql security definer set search_path = public as $$
declare
  a       kpi_assignments%rowtype;
  month1  date := date_trunc('month', p_starts_from)::date;
  fy_from date;
  fy_to   date;
  earlier date;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  if not (a.employee_id = current_employee_id()
          or manages_employee(a.employee_id)
          or is_hr_admin()) then
    raise exception 'You can only set the start month on your own KPI';
  end if;

  if p_starts_from is null then
    raise exception 'Choose the month this KPI starts from';
  end if;

  select starts_on, ends_on into fy_from, fy_to
  from financial_years where code = a.financial_year;

  if month1 < fy_from or month1 > fy_to then
    raise exception
      'The start month must be inside FY % (% to %)',
      a.financial_year, to_char(fy_from, 'Mon-YY'), to_char(fy_to, 'Mon-YY');
  end if;

  select min(period_month) into earlier
  from kpi_submissions
  where employee_id = a.employee_id
    and financial_year = a.financial_year
    and period_month < month1;

  if earlier is not null then
    raise exception
      'This KPI already has an assessment for %, which is before %. '
      'Delete that month first, or choose an earlier start.',
      to_char(earlier, 'Mon-YY'), to_char(month1, 'Mon-YY');
  end if;

  update kpi_assignments set starts_from = month1
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'start_month_set',
                    jsonb_build_object('starts_from', month1));
  return a;
end $$;

grant execute on function set_kpi_start(uuid, date) to authenticated;

comment on function set_kpi_start(uuid, date) is
  'Sets the first month a KPI is expected for. Allowed after approval — '
  'unlike the rows — but never past a month already assessed.';


-- ---------------------------------------------------------------------
-- Validation gains one line.
--
-- Put here rather than in submit and approve separately, because both of
-- those already call this and a rule enforced in one place cannot drift
-- out of step with itself. It also means the setup screen shows the
-- question as a validation message before anybody presses anything.
--
-- Reproduced whole; CREATE OR REPLACE FUNCTION takes no patches.
-- ---------------------------------------------------------------------
create or replace function validate_assignment(p_assignment_id uuid)
returns table (ok boolean, message text)
language plpgsql stable as $$
declare
  a           kpi_assignments%rowtype;
  job_sum     numeric;
  core_sum    numeric;
  esms_sum    numeric;
  item_count  int;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then
    return query select false, 'Assignment not found'; return;
  end if;

  select
    coalesce(sum(weightage) filter (where section = 'job_role'), 0),
    coalesce(sum(weightage) filter (where section = 'core_values'), 0),
    coalesce(sum(weightage) filter (where section = 'esms'), 0),
    count(*)
  into job_sum, core_sum, esms_sum, item_count
  from kpi_assignment_items where assignment_id = p_assignment_id;

  if item_count = 0 then
    return query select false, 'No KPI rows have been added'; return;
  end if;

  -- Compared at full precision, reported at one decimal: rounding the
  -- comparison would let 79.999% pass as 80%.
  if job_sum <> a.job_role_weight then
    return query select false, format(
      'Job Role weightages total %s%%, they must total %s%%',
      round(job_sum, 1), round(a.job_role_weight, 1));
    return;
  end if;
  if core_sum <> a.core_values_weight then
    return query select false, format(
      'Core Values weightages total %s%%, they must total %s%%',
      round(core_sum, 1), round(a.core_values_weight, 1));
    return;
  end if;
  if esms_sum <> a.esms_weight then
    return query select false, format(
      'ESMS weightages total %s%%, they must total %s%%',
      round(esms_sum, 1), round(a.esms_weight, 1));
    return;
  end if;

  if a.job_role_weight + a.core_values_weight + a.esms_weight <> 100 then
    return query select false, format(
      'The sections total %s%%, they must total 100%%',
      round(a.job_role_weight + a.core_values_weight + a.esms_weight, 1));
    return;
  end if;

  -- New in 0043. Asked plainly, because the person reading it is being
  -- asked a question rather than told about a rule.
  if a.starts_from is null then
    return query select false,
      'Say which month this KPI starts from — April if it runs the whole '
      'year, or the month this person joined.';
    return;
  end if;

  return query select true, 'Valid';
end $$;


-- ---------------------------------------------------------------------
-- A month before the start cannot be opened at all.
--
-- The screens will not offer it, but the screens are not the guarantee.
-- Reproduced whole from 0024 with one check added.
-- ---------------------------------------------------------------------
create or replace function open_submission(p_employee_id uuid, p_period_month date)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare
  s      kpi_submissions%rowtype;
  a      kpi_assignments%rowtype;
  fy     text;
  month1 date := date_trunc('month', p_period_month)::date;
begin
  select * into s from kpi_submissions
  where employee_id = p_employee_id and period_month = month1;
  if found then return s; end if;

  select code into fy from financial_years
  where month1 between starts_on and ends_on;
  if fy is null then
    raise exception 'No financial year covers %', month1;
  end if;

  select * into a from kpi_assignments
  where employee_id = p_employee_id and financial_year = fy and status = 'active';
  if not found then
    raise exception 'No approved KPI is in place for this employee for FY %', fy;
  end if;

  if a.starts_from is not null and month1 < a.starts_from then
    raise exception
      'This KPI starts from %, so % is not assessed.',
      to_char(a.starts_from, 'Mon-YY'), to_char(month1, 'Mon-YY');
  end if;

  insert into kpi_submissions (assignment_id, employee_id, manager_id,
                               financial_year, period_month, status)
  select a.id, p_employee_id, e.reporting_manager_id, fy, month1, 'draft'
  from employees e where e.id = p_employee_id
  returning * into s;

  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  select
    s.id, ai.id, ai.section, ai.kra, ai.kpi_description,
    ai.weightage,
    case when ai.section = 'job_role' then
      coalesce(
        (select pi.target_value
         from kpi_submission_items pi
         join kpi_submissions ps on ps.id = pi.submission_id
         where ps.employee_id = p_employee_id
           and ps.period_month < month1
           and pi.assignment_item_id = ai.id
         order by ps.period_month desc
         limit 1),
        ai.target_value)
    else
      ai.target_value
    end,
    ai.target_unit, ai.scoring_rule, ai.rule_params, ai.sort_order
  from kpi_assignment_items ai
  where ai.assignment_id = a.id;

  insert into core_value_ratings (submission_id, core_value_id)
  select s.id, cv.id from core_value_definitions cv where cv.is_active;

  perform log_audit('kpi_submission', s.id, 'opened',
                    jsonb_build_object('period', month1));
  return s;
end $$;


-- ---------------------------------------------------------------------
-- The reports stop generating months that were never owed.
--
-- Filtered in the view rather than flagged with a column, so every
-- consumer inherits it — kpi_report, kpi_ranking and the org screens all
-- count rows, and a row that should not exist is better removed than
-- labelled and then remembered about in four places.
--
-- The first nineteen columns are byte-for-byte what 0035 left them.
-- CREATE OR REPLACE VIEW may append columns and nothing else; the FROM
-- and WHERE underneath them are free to change.
-- ---------------------------------------------------------------------
create or replace view v_kpi_report_rows
with (security_invoker = true) as
select
  fy.code                                   as financial_year,
  mo.period_month,
  tm.id                                     as employee_id,
  tm.ecode,
  tm.full_name,
  coalesce(nullif(trim(tm.function_name), ''), 'Unassigned')  as function_name,
  coalesce(nullif(trim(tm.department), ''), 'Unassigned')     as department,
  mgr.id                                    as manager_id,
  mgr.ecode                                 as manager_ecode,
  mgr.full_name                             as manager_name,
  sub.status,
  sub.final_total_score,

  exists (
    select 1 from kpi_assignments a
    where a.employee_id = tm.id
      and a.financial_year = fy.code
      and a.status = 'active'
  )                                         as has_kpi,

  clk.completion_tat_days,
  clk.pending_tat_days,
  clk.submit_tat_days,

  (mo.period_month >= pol.starts_from)      as counts_for_tat,

  case when mo.period_month >= pol.starts_from and clk.submit_tat_days is not null
    then greatest(0, clk.submit_tat_days - pol.tm_grace_days)
  end                                       as submit_delay_days,
  case when mo.period_month >= pol.starts_from and clk.completion_tat_days is not null
    then greatest(0, clk.completion_tat_days - pol.manager_grace_days)
  end                                       as completion_delay_days,
  case when mo.period_month >= pol.starts_from and clk.pending_tat_days is not null
    then greatest(0, clk.pending_tat_days - pol.manager_grace_days)
  end                                       as pending_delay_days
from financial_years fy
cross join lateral generate_series(
  fy.starts_on, fy.ends_on, interval '1 month') gs
cross join lateral (select gs::date as period_month) mo
cross join lateral (
  select
    coalesce((select (value->>'tm_grace_days')::int
              from app_settings where key = 'tat_policy'), 3)      as tm_grace_days,
    coalesce((select (value->>'manager_grace_days')::int
              from app_settings where key = 'tat_policy'), 5)      as manager_grace_days,
    coalesce((select nullif(value->>'starts_from', '')::date
              from app_settings where key = 'tat_policy'),
             '1900-01-01'::date)                                   as starts_from
) pol
join employees tm
  on tm.is_active and tm.reporting_manager_id is not null
join employees mgr
  on mgr.id = tm.reporting_manager_id and mgr.is_active
-- Whichever KPI is live for them this year — draft, awaiting approval or
-- active. The partial unique index guarantees there is at most one.
left join lateral (
  select asg.starts_from
  from kpi_assignments asg
  where asg.employee_id = tm.id
    and asg.financial_year = fy.code
    and asg.status in ('draft','pending_approval','active')
  limit 1
) kpi on true
left join kpi_submissions sub
  on sub.employee_id = tm.id and sub.period_month = mo.period_month
cross join lateral (
  select
    case when sub.status in ('scored','finalized') and sub.manager_scored_at is not null then
      greatest(0, extract(epoch from (
        sub.manager_scored_at
        - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
      )) / 86400.0)
    end as completion_tat_days,
    case when sub.status is null or sub.status not in ('scored','finalized')
           or sub.manager_scored_at is null then
      greatest(0, extract(epoch from (
        now() - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
      )) / 86400.0)
    end as pending_tat_days,
    case when sub.self_submitted_at is not null then
      greatest(0, extract(epoch from (
        sub.self_submitted_at
        - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
      )) / 86400.0)
    end as submit_tat_days
) clk
-- Unanswered is not the same as April, but it has to behave like
-- something, and behaving like today means this migration moves no
-- numbers until somebody answers.
where mo.period_month >= coalesce(kpi.starts_from, fy.starts_on);

grant select on v_kpi_report_rows to authenticated;


-- ---------------------------------------------------------------------
-- And the manager's month grid, same rule.
--
-- A manager whose whole team joined in June now has no April row at all,
-- rather than an April row saying everybody is outstanding.
-- ---------------------------------------------------------------------
create or replace view v_manager_month_status
with (security_invoker = true) as
with months as (
  select fy.code as financial_year, fy.starts_on, gs::date as period_month
  from financial_years fy
  cross join lateral generate_series(
    fy.starts_on, fy.ends_on, interval '1 month') gs
)
select
  mo.financial_year,
  mo.period_month,
  mgr.id                                  as manager_id,
  mgr.ecode                               as manager_ecode,
  mgr.full_name                           as manager_name,
  mgr.department,
  count(tm.id)::int                       as team_size,
  count(*) filter (
    where sub.id is null or sub.status = 'draft')::int   as not_submitted,
  count(*) filter (where sub.status = 'submitted')::int  as awaiting_manager,
  count(*) filter (where sub.status = 'returned')::int   as returned,
  count(*) filter (
    where sub.status in ('scored','finalized'))::int     as scored,
  round(avg(sub.final_total_score) filter (
    where sub.status in ('scored','finalized')), 2)      as team_avg_score
from months mo
join employees tm on tm.is_active and tm.reporting_manager_id is not null
join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
left join lateral (
  select asg.starts_from
  from kpi_assignments asg
  where asg.employee_id = tm.id
    and asg.financial_year = mo.financial_year
    and asg.status in ('draft','pending_approval','active')
  limit 1
) kpi on true
left join kpi_submissions sub
       on sub.employee_id = tm.id and sub.period_month = mo.period_month
where mo.period_month >= coalesce(kpi.starts_from, mo.starts_on)
group by mo.financial_year, mo.period_month,
         mgr.id, mgr.ecode, mgr.full_name, mgr.department;

grant select on v_manager_month_status to authenticated;

comment on view v_manager_month_status is
  'One row per manager per month of the financial year, counting only '
  'the people whose KPI had started by that month. Managers with no '
  'activity still appear, because "who has not done June" is the '
  'question this exists to answer.';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Writes are made and then undone by hand: this file runs in one
-- transaction that commits, so nothing rolls itself back.
-- ---------------------------------------------------------------------
do $$
declare
  fy       text;
  fy_start date;
  aid      uuid;
  emp      uuid;
  was      date;
  before_n int;
  after_n  int;
  msg      text;
  ok_flag  boolean;
  target   date;
begin
  select code, starts_on into fy, fy_start from financial_years where is_current;

  -- Nothing may have been backfilled — an answer nobody gave is the one
  -- thing this migration must not invent.
  if exists (select 1 from kpi_assignments
             where financial_year = fy and starts_from is not null) then
    raise exception 'starts_from was populated somewhere — it must start null';
  end if;

  select a.id, a.employee_id into aid, emp
  from kpi_assignments a
  where a.financial_year = fy and a.status = 'active'
    and not exists (
      select 1 from kpi_submissions s
      where s.employee_id = a.employee_id and s.financial_year = fy)
  limit 1;

  if aid is null then
    raise notice
      '0043 self-test partial — no unassessed active KPI to move; '
      'column, guards and views installed';
    return;
  end if;

  select count(*) into before_n
  from v_kpi_report_rows where employee_id = emp and financial_year = fy;

  -- Two months in, so there is something to exclude.
  target := (fy_start + interval '2 months')::date;
  perform set_kpi_start(aid, target);

  select count(*) into after_n
  from v_kpi_report_rows where employee_id = emp and financial_year = fy;

  if after_n <> before_n - 2 then
    raise exception
      'moving the start two months on changed the report from % rows to % — '
      'expected %', before_n, after_n, before_n - 2;
  end if;

  if exists (
    select 1 from v_kpi_report_rows
    where employee_id = emp and financial_year = fy and period_month < target)
  then
    raise exception 'a month before the start is still being reported';
  end if;

  -- Outside the year is refused.
  begin
    perform set_kpi_start(aid, (fy_start - interval '1 month')::date);
    raise exception 'a start month before the financial year was accepted';
  exception when others then
    if sqlerrm not like 'The start month must be inside FY%' then raise; end if;
  end;

  -- Not first of the month is normalised rather than rejected.
  perform set_kpi_start(aid, (target + 5));
  select starts_from into was from kpi_assignments where id = aid;
  if was <> target then
    raise exception 'mid-month date was not snapped to the 1st (got %)', was;
  end if;

  -- A month before the start cannot be opened.
  begin
    perform open_submission(emp, fy_start);
    raise exception 'a month before the start was opened anyway';
  exception when others then
    if sqlerrm not like 'This KPI starts from%' then raise; end if;
  end;

  -- Validation asks for it when it is missing.
  update kpi_assignments set starts_from = null where id = aid;
  select ok, message into ok_flag, msg from validate_assignment(aid);
  if ok_flag then
    raise exception 'validation passed a KPI with no start month';
  end if;
  if msg not like 'Say which month%' then
    raise exception 'validation failed for the wrong reason: %', msg;
  end if;

  -- Put it back exactly as found.
  update kpi_assignments set starts_from = null where id = aid;

  raise notice
    '0043 self-test passed — % report rows became % after a two-month '
    'start, and the guards hold', before_n, after_n;
end $$;
