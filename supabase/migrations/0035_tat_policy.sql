-- =====================================================================
-- Cyrix KPI  ·  0035  ·  A cool-off period, and a month to start from
--
-- Every turnaround figure so far has been raw: the clock starts when the
-- month ends and runs until the work is done. Nobody is expected to
-- submit on the 1st, so a raw figure of 2.4 days is not late — it is
-- normal — and reporting it as though it were is how a metric stops
-- being read.
--
-- Two settings, both SW Admin's:
--
--   tm_grace_days       days a team member gets before it counts (3)
--   manager_grace_days  days a manager gets before it counts (5)
--   starts_from         the first month TAT is measured at all
--
-- The delay is what is left after the allowance — a team member who
-- takes 4 days against an allowance of 3 is one day late, not four. It
-- floors at zero: finishing early is on time, not credit to spend on the
-- next month.
--
-- starts_from exists because the system went live mid-year with months
-- already outstanding. Holding people to a clock that started before
-- they had the app measures the rollout, not the team. Null means
-- everything counts, which is what today's numbers already do — so this
-- migration changes no figure until somebody chooses a month.
--
-- The raw TAT columns are untouched and still say what they say. The
-- allowance is applied where the aggregating happens, because that is
-- where "calculating TAT" actually is; a column called submit_tat_days
-- that quietly returned something else would be worse than no column.
--
-- Completion % is deliberately NOT gated by starts_from. A month that
-- was owed is owed whenever it was owed — the start date is about how
-- fast, not about whether.
-- =====================================================================

insert into app_settings (key, value, description) values
  ('tat_policy',
   '{"tm_grace_days": 3, "manager_grace_days": 5, "starts_from": null}'::jsonb,
   'Days each side gets before turnaround counts against them, and the first month turnaround is measured at all. starts_from null = every month counts.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- SW Admin writes it.
--
-- app_settings is HR-writable by RLS, and this is not an HR decision —
-- it is a rollout decision, which is SW Admin's remit. A definer
-- function is the gate: it checks the role itself rather than widening
-- the table policy, so nothing else on app_settings becomes writable by
-- anyone new.
-- ---------------------------------------------------------------------
create or replace function set_tat_policy(
  p_tm_grace      int,
  p_manager_grace int,
  p_starts_from   date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not (is_sw_admin() or is_hr_admin()) then
    raise exception 'Only SW Admin can change the turnaround policy';
  end if;

  if p_tm_grace is null or p_tm_grace < 0 or p_tm_grace > 60
     or p_manager_grace is null or p_manager_grace < 0 or p_manager_grace > 60 then
    raise exception 'A cool-off period must be between 0 and 60 days';
  end if;

  -- The manager's clock runs from the same month boundary as the team
  -- member's, so an allowance that ends first would mean the manager was
  -- late before the work could arrive.
  if p_manager_grace < p_tm_grace then
    raise exception
      'The manager allowance (% days) cannot end before the team member''s (% days)',
      p_manager_grace, p_tm_grace;
  end if;

  v := jsonb_build_object(
    'tm_grace_days', p_tm_grace,
    'manager_grace_days', p_manager_grace,
    -- Snapped to the 1st: a month is the unit, and "from the 12th of
    -- August" is not a thing this system can mean.
    'starts_from', case when p_starts_from is null then null
                       else to_char(date_trunc('month', p_starts_from), 'YYYY-MM-DD') end
  );

  insert into app_settings (key, value, description, updated_at)
  values ('tat_policy', v, 'Days each side gets before turnaround counts against them, and the first month turnaround is measured at all. starts_from null = every month counts.', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return v;
end $$;

grant execute on function set_tat_policy(int, int, date) to authenticated;


-- ---------------------------------------------------------------------
-- The rows.
--
-- Restructured so the three clocks are computed once in a lateral and
-- the allowance is subtracted from them by name. The first sixteen
-- columns are byte-for-byte what they were — CREATE OR REPLACE VIEW may
-- append and nothing else — and the FROM clause is free to change
-- underneath them.
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

  -- Is this month inside the window SW Admin opened?
  (mo.period_month >= pol.starts_from)      as counts_for_tat,

  -- What is left after the allowance. Null where the raw clock is null,
  -- because greatest(0, null) is 0 in Postgres and "no reading" is not
  -- the same as "on time".
  case when mo.period_month >= pol.starts_from and clk.submit_tat_days is not null
    then greatest(0, clk.submit_tat_days - pol.tm_grace_days)
  end                                       as submit_delay_days,
  case when mo.period_month >= pol.starts_from and clk.completion_tat_days is not null
    then greatest(0, clk.completion_tat_days - pol.manager_grace_days)
  end                                       as completion_delay_days,
  -- Judged against the manager's allowance: a month nobody has finished
  -- is overdue once the last deadline in the chain has passed, not the
  -- first one.
  case when mo.period_month >= pol.starts_from and clk.pending_tat_days is not null
    then greatest(0, clk.pending_tat_days - pol.manager_grace_days)
  end                                       as pending_delay_days
from financial_years fy
cross join lateral generate_series(
  fy.starts_on, fy.ends_on, interval '1 month') gs
cross join lateral (select gs::date as period_month) mo
-- A lateral with no FROM returns exactly one row, always. A plain join
-- to app_settings would return none if the row were ever missing, and an
-- empty v_kpi_report_rows would take the whole report down with it.
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
) clk;

grant select on v_kpi_report_rows to authenticated;


-- ---------------------------------------------------------------------
-- HR's report.
-- ---------------------------------------------------------------------
drop function if exists kpi_report(text, date, text, text, uuid, text[]);

create function kpi_report(
  p_financial_year text,
  p_month          date    default null,
  p_function       text    default null,
  p_department     text    default null,
  p_manager_id     uuid    default null,
  p_group_by       text[]  default array['function','department','manager']
)
returns table (
  function_name    text,
  department       text,
  manager_id       uuid,
  manager_ecode    text,
  manager_name     text,
  team             bigint,
  scored           bigint,
  to_score         bigint,
  not_submitted    bigint,
  kpi_not_set      bigint,
  scored_pct       numeric,
  avg_score        numeric,
  submit_tat       numeric,
  completion_tat   numeric,
  pending_tat      numeric,
  submit_delay     numeric,
  completion_delay numeric,
  pending_delay    numeric
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

  -- The filter on counts_for_tat is the whole point of starts_from: the
  -- months before it are still counted as owed, still counted as scored,
  -- and simply have no clock on them.
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
      round(avg(r.submit_tat_days) filter (where r.counts_for_tat), 1)      as submit_tat,
      round(avg(r.completion_tat_days) filter (where r.counts_for_tat), 1)  as completion_tat,
      round(avg(r.pending_tat_days) filter (where r.counts_for_tat), 1)     as pending_tat,
      round(avg(r.submit_delay_days), 1)                           as submit_delay,
      round(avg(r.completion_delay_days), 1)                       as completion_delay,
      round(avg(r.pending_delay_days), 1)                          as pending_delay
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
-- The manager's own standing.
--
-- The tie-breaks move to the delay figures. Same direction, but they
-- respect the window — ranking a manager on months the organisation has
-- decided not to count is the kind of detail that makes a league table
-- unexplainable to the person at the bottom of it.
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
  pending_tat      numeric,
  submit_delay     numeric,
  completion_delay numeric,
  pending_delay    numeric,
  tm_grace_days    integer,
  mgr_grace_days   integer,
  tat_starts_from  date
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
  pol    jsonb := coalesce(
                    (select value from app_settings where key = 'tat_policy'),
                    '{}'::jsonb);
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
      round(avg(r.submit_tat_days) filter (where r.counts_for_tat), 1)     as sub_tat,
      round(avg(r.completion_tat_days) filter (where r.counts_for_tat), 1) as comp_tat,
      round(avg(r.pending_tat_days) filter (where r.counts_for_tat), 1)    as pend_tat,
      round(avg(r.submit_delay_days), 1)                              as sub_late,
      round(avg(r.completion_delay_days), 1)                          as comp_late,
      round(avg(r.pending_delay_days), 1)                             as pend_late
    from v_kpi_report_rows r
    where r.financial_year = fy
      and r.period_month < date_trunc('month', current_date)::date
    group by r.manager_id
  ),
  mgr_ranked as (
    select
      b.*,
      -- Completion first, then how overdue the backlog is, then how long
      -- the finished work took. How quickly the team submits is still not
      -- part of it: that is the team's behaviour, not the manager's.
      rank() over (
        order by b.pct desc, b.pend_late asc nulls first, b.comp_late asc nulls first
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
    m.pend_tat,
    m.sub_late,
    m.comp_late,
    m.pend_late,
    coalesce((pol->>'tm_grace_days')::int, 3),
    coalesce((pol->>'manager_grace_days')::int, 5),
    nullif(pol->>'starts_from', '')::date
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $$;

grant execute on function kpi_ranking(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Checks the wiring against whatever policy is live rather than setting
-- one: this file runs in a transaction that commits, so a test that
-- changed the policy would leave it changed.
-- ---------------------------------------------------------------------
do $$
declare
  fy        text;
  tm_grace  int;
  mgr_grace int;
  from_month date;
  mgr       uuid;
  rep       record;
  prof      record;
  n_bad     bigint;
begin
  select code into fy from financial_years where is_current;

  select coalesce((value->>'tm_grace_days')::int, 3),
         coalesce((value->>'manager_grace_days')::int, 5),
         nullif(value->>'starts_from', '')::date
  into tm_grace, mgr_grace, from_month
  from app_settings where key = 'tat_policy';

  if tm_grace is null then
    raise exception 'tat_policy did not land in app_settings';
  end if;

  -- The delay is the clock minus the allowance, floored at zero.
  select count(*) into n_bad
  from v_kpi_report_rows
  where counts_for_tat
    and submit_tat_days is not null
    and submit_delay_days
        is distinct from greatest(0, submit_tat_days - tm_grace);
  if n_bad <> 0 then
    raise exception '% row(s) do not apply the team member allowance', n_bad;
  end if;

  select count(*) into n_bad
  from v_kpi_report_rows
  where counts_for_tat
    and completion_tat_days is not null
    and completion_delay_days
        is distinct from greatest(0, completion_tat_days - mgr_grace);
  if n_bad <> 0 then
    raise exception '% row(s) do not apply the manager allowance', n_bad;
  end if;

  -- Nothing before the start month carries a delay at all.
  select count(*) into n_bad
  from v_kpi_report_rows
  where not counts_for_tat
    and (submit_delay_days is not null
         or completion_delay_days is not null
         or pending_delay_days is not null);
  if n_bad <> 0 then
    raise exception
      '% row(s) outside the counting window still carry a delay', n_bad;
  end if;

  -- A delay can never exceed the clock it came from, and never be
  -- negative. Both would mean the subtraction went the wrong way.
  select count(*) into n_bad
  from v_kpi_report_rows
  where (submit_delay_days is not null
         and (submit_delay_days < 0 or submit_delay_days > submit_tat_days))
     or (completion_delay_days is not null
         and (completion_delay_days < 0
              or completion_delay_days > completion_tat_days))
     or (pending_delay_days is not null
         and (pending_delay_days < 0 or pending_delay_days > pending_tat_days));
  if n_bad <> 0 then
    raise exception '% row(s) have a delay longer than the wait itself', n_bad;
  end if;

  -- The report and the profile must still agree, as 0031–0034 each
  -- asserted: they are the same numbers shown to two different people.
  select mgr.id into mgr
  from employees tm
  join employees mgr on mgr.id = tm.reporting_manager_id and mgr.is_active
  join kpi_submissions s
    on s.employee_id = tm.id and s.self_submitted_at is not null
  where tm.is_active and s.financial_year = fy
  group by mgr.id order by count(*) desc limit 1;

  if mgr is null then
    raise notice '0035 self-test skipped — nobody has submitted a month yet';
    return;
  end if;

  select * into rep  from kpi_report(fy, null, null, null, mgr, array['manager']);
  select * into prof from kpi_ranking(mgr, fy);

  if rep.submit_delay is distinct from prof.submit_delay
     or rep.completion_delay is distinct from prof.completion_delay
     or rep.pending_delay is distinct from prof.pending_delay then
    raise exception
      'report says %/%/% late and the profile says %/%/%',
      rep.submit_delay, rep.completion_delay, rep.pending_delay,
      prof.submit_delay, prof.completion_delay, prof.pending_delay;
  end if;

  if prof.tm_grace_days is distinct from tm_grace
     or prof.mgr_grace_days is distinct from mgr_grace then
    raise exception 'the profile reports an allowance the settings do not';
  end if;

  raise notice
    '0035 self-test passed — allowance %/% days, counting from %, '
    'this manager is %/% days late on submit/completion',
    tm_grace, mgr_grace, coalesce(from_month::text, 'the first month'),
    coalesce(rep.submit_delay::text, '—'),
    coalesce(rep.completion_delay::text, '—');
end $$;
