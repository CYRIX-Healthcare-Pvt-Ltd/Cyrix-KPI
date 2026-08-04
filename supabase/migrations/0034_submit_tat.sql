-- =====================================================================
-- Cyrix KPI  ·  0034  ·  How long the team takes to send it in
--
-- 0033 dropped TM TAT because it split the wait by who was holding it
-- rather than by whether it was done. That lost something real: a
-- manager can be quick and still be carrying a team that sends
-- everything in three weeks late, and nothing in the report said so.
--
-- It comes back as Submit TAT, and the three now read as the sequence
-- they actually are:
--
--     Submit TAT      they sent it in      → how slow is the team
--     Completion TAT  you scored it        → how slow is the manager
--     Pending TAT     nobody has yet       → how old is what is left
--
-- Submit TAT counts only the months that were submitted, which would be
-- the same hole 0031 and 0032 each closed — except it is not, here. The
-- months nobody submitted are already counted, in Pending TAT and in the
-- With team member column beside it. Measuring them twice would not add
-- information; it would just make two columns move together and neither
-- mean anything on its own.
-- =====================================================================

drop function if exists kpi_report(text, date, text, text, uuid, text[]);

-- Appended rather than reordered: CREATE OR REPLACE VIEW may add columns
-- at the end and nothing else, and everything selects by name anyway.
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

  case when sub.status in ('scored','finalized') and sub.manager_scored_at is not null then
    greatest(0, extract(epoch from (
      sub.manager_scored_at
      - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as completion_tat_days,
  case when sub.status is null or sub.status not in ('scored','finalized')
         or sub.manager_scored_at is null then
    greatest(0, extract(epoch from (
      now() - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as pending_tat_days,

  -- The team member's half of the wait. Null until they send it, so the
  -- average is over the months they actually submitted — the ones they
  -- never sent are Pending TAT's to report, not this column's.
  case when sub.self_submitted_at is not null then
    greatest(0, extract(epoch from (
      sub.self_submitted_at
      - ((mo.period_month + interval '1 month') at time zone 'Asia/Kolkata')
    )) / 86400.0)
  end                                       as submit_tat_days
from financial_years fy
cross join lateral generate_series(
  fy.starts_on, fy.ends_on, interval '1 month') gs
cross join lateral (select gs::date as period_month) mo
join employees tm
  on tm.is_active and tm.reporting_manager_id is not null
join employees mgr
  on mgr.id = tm.reporting_manager_id and mgr.is_active
left join kpi_submissions sub
  on sub.employee_id = tm.id and sub.period_month = mo.period_month;

grant select on v_kpi_report_rows to authenticated;


create function kpi_report(
  p_financial_year text,
  p_month          date    default null,
  p_function       text    default null,
  p_department     text    default null,
  p_manager_id     uuid    default null,
  p_group_by       text[]  default array['function','department','manager']
)
returns table (
  function_name   text,
  department      text,
  manager_id      uuid,
  manager_ecode   text,
  manager_name    text,
  team            bigint,
  scored          bigint,
  to_score        bigint,
  not_submitted   bigint,
  kpi_not_set     bigint,
  scored_pct      numeric,
  avg_score       numeric,
  submit_tat      numeric,
  completion_tat  numeric,
  pending_tat     numeric
)
language plpgsql stable security invoker set search_path = public as $$
declare
  allowed  text[] := array['function','department','manager'];
  dim      text;
  sel      text := '';
  grp      text := '';
begin
  if p_group_by is null or cardinality(p_group_by) = 0 then
    raise exception 'Choose at least one of function, department or manager';
  end if;

  foreach dim in array p_group_by loop
    if not (dim = any (allowed)) then
      raise exception 'Cannot group by %', dim;
    end if;
  end loop;

  sel := sel || case when 'function' = any (p_group_by)
                     then 'r.function_name' else 'null::text' end || ', ';
  sel := sel || case when 'department' = any (p_group_by)
                     then 'r.department' else 'null::text' end || ', ';
  sel := sel || case when 'manager' = any (p_group_by)
                     then 'r.manager_id, r.manager_ecode, r.manager_name'
                     else 'null::uuid, null::text, null::text' end;

  grp := (select string_agg(
            case g when 'function' then 'r.function_name'
                   when 'department' then 'r.department'
                   else 'r.manager_id, r.manager_ecode, r.manager_name' end, ', ')
          from unnest(p_group_by) g);

  return query execute format($q$
    select %s,
      count(*)                                                    as team,
      count(*) filter (where r.status in ('scored','finalized'))   as scored,
      count(*) filter (where r.status = 'submitted')               as to_score,
      count(*) filter (where r.has_kpi
                         and (r.status is null
                              or r.status in ('draft','returned'))) as not_submitted,
      count(*) filter (where not r.has_kpi
                         and (r.status is null
                              or r.status in ('draft','returned'))) as kpi_not_set,
      round(100.0 * count(*) filter (where r.status in ('scored','finalized'))
            / nullif(count(*), 0), 1)                              as scored_pct,
      round(avg(r.final_total_score) filter (
              where r.status in ('scored','finalized')), 2)        as avg_score,
      round(avg(r.submit_tat_days), 1)                             as submit_tat,
      round(avg(r.completion_tat_days), 1)                         as completion_tat,
      round(avg(r.pending_tat_days), 1)                            as pending_tat
    from v_kpi_report_rows r
    where r.financial_year = $1
      and ($2::date is null or r.period_month = $2)
      and r.period_month < date_trunc('month', current_date)::date
      and ($3::text is null or r.function_name = $3)
      and ($4::text is null or r.department = $4)
      and ($5::uuid is null or r.manager_id = $5)
    group by %s
    order by %s
  $q$, sel, grp, grp)
  using p_financial_year, p_month, p_function, p_department, p_manager_id;
end $$;

grant execute on function kpi_report(text, date, text, text, uuid, text[])
  to authenticated;


-- ---------------------------------------------------------------------
-- The manager sees it too — it is their team being described.
-- ---------------------------------------------------------------------
drop function if exists kpi_ranking(uuid, text);

create function kpi_ranking(
  p_employee_id    uuid default null,
  p_financial_year text default null
)
returns table (
  employee_id      uuid,
  financial_year   text,
  score            numeric,
  team_rank        integer,
  team_of          integer,
  org_rank         integer,
  org_of           integer,
  team_size        integer,
  mgr_rank         integer,
  mgr_of           integer,
  completion_pct   numeric,
  due_months       integer,
  scored_months    integer,
  submit_tat       numeric,
  completion_tat   numeric,
  pending_tat      numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
begin
  if target is null then
    return;
  end if;

  if not (target = current_employee_id()
          or manages_employee(target)
          or is_hr_admin()) then
    raise exception 'You can only see your own ranking';
  end if;

  return query
  with scored_people as (
    select
      s.employee_id                       as emp,
      e.reporting_manager_id              as mgr,
      round(avg(s.final_total_score), 4)  as avg_score
    from kpi_submissions s
    join employees e on e.id = s.employee_id and e.is_active
    where s.financial_year = fy
      and s.status in ('scored', 'finalized')
      and s.final_total_score is not null
    group by s.employee_id, e.reporting_manager_id
  ),
  ranked as (
    select
      sp.emp,
      sp.avg_score,
      rank()  over (partition by sp.mgr order by sp.avg_score desc) as t_rank,
      count(*) over (partition by sp.mgr)                           as t_of,
      rank()  over (order by sp.avg_score desc)                     as o_rank,
      count(*) over ()                                              as o_of
    from scored_people sp
  ),
  by_manager as (
    select
      r.manager_id                                                    as mgr_id,
      count(*)::int                                                   as n_due,
      count(*) filter (
        where r.status in ('scored','finalized'))::int                as n_done,
      round(100.0 * count(*) filter (
        where r.status in ('scored','finalized')) / count(*), 1)      as pct,
      round(avg(r.submit_tat_days), 1)                                as sub_tat,
      round(avg(r.completion_tat_days), 1)                            as comp_tat,
      round(avg(r.pending_tat_days), 1)                               as pend_tat
    from v_kpi_report_rows r
    where r.financial_year = fy
      and r.period_month < date_trunc('month', current_date)::date
    group by r.manager_id
  ),
  mgr_ranked as (
    select
      b.*,
      -- Unchanged: the rank is about the manager, and how quickly their
      -- team submits is not theirs to be ranked on.
      rank() over (
        order by b.pct desc, b.pend_tat asc nulls first, b.comp_tat asc nulls first
      )                                                as m_rank,
      count(*) over ()                                 as m_of
    from by_manager b
  )
  select
    target,
    fy,
    round(r.avg_score, 2),
    r.t_rank::int,
    r.t_of::int,
    r.o_rank::int,
    r.o_of::int,
    (select count(*)::int
     from employees p
     where p.is_active
       and p.reporting_manager_id =
           (select reporting_manager_id from employees where id = target)),
    m.m_rank::int,
    m.m_of::int,
    m.pct,
    m.n_due,
    m.n_done,
    m.sub_tat,
    m.comp_tat,
    m.pend_tat
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  fy    text;
  mgr   uuid;
  rep   record;
  prof  record;
  n_bad bigint;
begin
  select code into fy from financial_years where is_current;

  -- A month cannot be scored before it was submitted, so the completion
  -- clock can never read earlier than the submit clock on the same row.
  -- If it does, the two case expressions have been crossed.
  select count(*) into n_bad
  from v_kpi_report_rows
  where financial_year = fy
    and submit_tat_days is not null
    and completion_tat_days is not null
    and completion_tat_days < submit_tat_days - 0.0001;
  if n_bad <> 0 then
    raise exception
      '% month(s) were scored before they were submitted', n_bad;
  end if;

  -- Submitted-but-unscored months belong to submit AND pending, which is
  -- correct — the team has done its part and the manager has not — but
  -- they must never be in submit and completion at once with no score.
  select count(*) into n_bad
  from v_kpi_report_rows
  where financial_year = fy
    and completion_tat_days is not null
    and (status is null or status not in ('scored','finalized'));
  if n_bad <> 0 then
    raise exception '% unscored month(s) carry a completion time', n_bad;
  end if;

  select mgr.id into mgr
  from employees tm
  join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
  join kpi_submissions s
    on s.employee_id = tm.id and s.self_submitted_at is not null
  where tm.is_active and s.financial_year = fy
  group by mgr.id order by count(*) desc limit 1;

  if mgr is null then
    raise notice '0034 self-test skipped — nobody has submitted a month yet';
    return;
  end if;

  select * into rep  from kpi_report(fy, null, null, null, mgr, array['manager']);
  select * into prof from kpi_ranking(mgr, fy);

  if rep.submit_tat is null then
    raise exception 'a manager whose team has submitted has no submit TAT';
  end if;
  if rep.submit_tat is distinct from prof.submit_tat then
    raise exception 'report says % and the profile says %',
      rep.submit_tat, prof.submit_tat;
  end if;
  -- Compared over the SAME months, not the two column averages.
  --
  -- The first draft of this asserted submit_tat <= completion_tat on the
  -- report row and failed on real data: the team had submitted twelve
  -- months, three of them nearly a hundred days late, and only the eight
  -- recent ones had been scored. 18.1 against 2.7, both correct, because
  -- they average different populations. Which is the very mistake this
  -- migration series has been fixing, committed in the test that was
  -- supposed to catch it.
  select count(*) into n_bad from (
    select avg(submit_tat_days) as s, avg(completion_tat_days) as c
    from v_kpi_report_rows
    where financial_year = fy
      and submit_tat_days is not null
      and completion_tat_days is not null
  ) x where x.c < x.s - 0.0001;
  if n_bad <> 0 then
    raise exception
      'over the months that are both submitted and scored, scoring came first';
  end if;

  raise notice
    '0034 self-test passed — team submits in % days, manager scores in % '
    '(over the months it has scored), pending %',
    rep.submit_tat, rep.completion_tat, rep.pending_tat;
end $$;
