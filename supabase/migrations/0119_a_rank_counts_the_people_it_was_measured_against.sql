-- =====================================================================
-- Cyrix KPI  ·  0119  ·  A rank counts the people it was measured against
--
-- "36th of 172" is how the manager tile reads today, and it is the wrong
-- shape of true. 128 of those 172 managers have no scored reportee at
-- all: their mark is null, rank() puts every one of them on the same
-- 45th, and the 172 in the denominator is the roll of managers rather
-- than the field anybody was ranked against.
--
-- So 36th of 172 sounds like the top quarter and is 36th of 44 -- the
-- bottom third of everyone who could be measured. A manager reading it
-- draws the opposite conclusion from the truth, which is worse than
-- showing nothing.
--
-- The employee tiles have said this properly since 0096: team rank is
-- "2nd of 8" with "8 of 16 scored so far" underneath. This returns the
-- one number the manager tile needs to say the same thing.
--
-- The body below is the live definition read back with pg_get_functiondef,
-- with three splices and nothing retyped.
-- =====================================================================

-- Dropped and recreated rather than replaced: a new column changes the
-- return type, and postgres refuses CREATE OR REPLACE for that. The
-- grants go with the drop and are restored below exactly as they were.
drop function if exists public.kpi_ranking(uuid, text);

CREATE OR REPLACE FUNCTION public.kpi_ranking(p_employee_id uuid DEFAULT NULL::uuid, p_financial_year text DEFAULT NULL::text)
 RETURNS TABLE(employee_id uuid, financial_year text, score numeric, team_rank integer, team_of integer, org_rank integer, org_of integer, team_size integer, mgr_rank integer, mgr_of integer, completion_pct numeric, due_months integer, scored_months integer, submit_tat numeric, completion_tat numeric, pending_tat numeric, submit_delay numeric, completion_delay numeric, pending_delay numeric, tm_grace_days integer, mgr_grace_days integer, tat_starts_from date, job_band integer, core_band integer, rank_value numeric, mgr_overall numeric, job_pct numeric, core_pct numeric, mgr_team_band numeric, mgr_team_scored integer, mgr_measured integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target uuid := coalesce(p_employee_id, current_employee_id());
  fy     text := coalesce(p_financial_year,
                          (select code from financial_years where is_current));
  pol    jsonb := coalesce(
                    (select value from app_settings where key = 'tat_policy'),
                    '{}'::jsonb);
  tm_days  numeric := coalesce((pol->>'tm_grace_days')::numeric, 3);
  mgr_days numeric := coalesce((pol->>'manager_grace_days')::numeric, 5);
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
      round(avg(s.final_total_score), 4)  as avg_score,
      -- Each half as a share of its OWN weightage, which is what the
      -- slab is defined on. The weights differ per person: core values
      -- is 20 normally and 15 for anybody carrying ESMS, so dividing by
      -- a constant would rate the two groups on different scales.
      avg(100.0 * s.final_job_role_score / nullif(a.job_role_weight, 0))    as job_pct,
      -- ESMS belongs to this half, not to nobody. It is carved out of
      -- the same 20 -- 5 ESMS and 15 core for anybody who carries it --
      -- so the band is the whole 20-point block either way, and an ESMS
      -- carrier is measured on the same scale as everybody else.
      avg(case when s.final_core_score is null then null else
            100.0 * (s.final_core_score + coalesce(s.final_esms_score, 0))
            / nullif(a.core_values_weight + coalesce(a.esms_weight, 0), 0)
          end) as core_pct
    from kpi_submissions s
    join employees e on e.id = s.employee_id and e.is_active
    left join kpi_assignments a
      on a.employee_id = s.employee_id and a.financial_year = s.financial_year
    where s.financial_year = fy
      and s.status in ('scored', 'finalized')
      and s.final_total_score is not null
    group by s.employee_id, e.reporting_manager_id
  ),
  combined as (
    select
      sp.*,
      kpi_rating(sp.job_pct)  as job_b,
      kpi_rating(sp.core_pct) as core_b,
      -- One half scored and not the other stands on its own rather than
      -- being averaged against a zero nobody awarded.
      case
        when kpi_rating(sp.job_pct) is null and kpi_rating(sp.core_pct) is null
          then null
        when kpi_rating(sp.job_pct) is null  then kpi_rating(sp.core_pct)::numeric
        when kpi_rating(sp.core_pct) is null then kpi_rating(sp.job_pct)::numeric
        else 0.6 * kpi_rating(sp.job_pct) + 0.4 * kpi_rating(sp.core_pct)
      end as rank_v
    from scored_people sp
  ),
  ranked as (
    select
      c.emp,
      c.avg_score,
      c.job_b,
      c.core_b,
      c.rank_v,
      c.job_pct,
      c.core_pct,
      -- The band first, then the job band, then the score itself. The
      -- slab is coarse on purpose, so without a final tie-break a team
      -- of five 4s would all be joint first.
      rank() over (partition by c.mgr
                   order by c.rank_v desc nulls last, c.job_b desc nulls last,
                            c.avg_score desc)                as t_rank,
      count(*) over (partition by c.mgr)                     as t_of,
      rank() over (order by c.rank_v desc nulls last, c.job_b desc nulls last,
                            c.avg_score desc)                as o_rank,
      count(*) over ()                                       as o_of
    from combined c
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
  team_band as (
    select c.mgr as mgr_id, avg(c.rank_v) as team_v, count(*) as team_n
    from combined c
    where c.rank_v is not null
    group by c.mgr
  ),
  mgr_marked as (
    select
      b.*,
      -- Carried through so the screen can name what the 70 was read
      -- off: the average, and how many scored people made it.
      t.team_v,
      t.team_n,
      tat_mark(b.sub_tat, tm_days)   as sub_mark,
      tat_mark(b.comp_tat, mgr_days) as comp_mark,
      -- How much of the team's year has actually been scored.
      --
      -- Not in the ratio management first gave, and the dry run showed
      -- why it has to be: without it a manager who had scored 1.2% of
      -- their team's months ranked FIRST, above one who had done 80%,
      -- because turnaround was the only thing measured and being quick
      -- about almost nothing beat being thorough. Speed on work you have
      -- not done is not a performance.
      case when b.pct is null then null else b.pct / 100.0 end as done_mark,
      -- The 1-5 slab onto 0-1, so it sits beside the two TAT marks.
      case when t.team_v is null then null else (t.team_v - 1) / 4 end as team_mark
    from by_manager b
    left join team_band t on t.mgr_id = b.mgr_id
  ),
  mgr_scored as (
    select
      m.*,
      -- Components that cannot be measured are dropped and the rest
      -- reweighted among themselves. A manager whose team has submitted
      -- nothing has no completion TAT, and scoring that as zero would
      -- rank them below one who scored everything late -- an absence of
      -- evidence read as a failure.
      -- Quality times coverage, not quality plus coverage.
      --
      -- Management's ratio is kept exactly as given for the quality half
      -- -- 20 submission TAT, 40 completion TAT, 40 team band -- and then
      -- multiplied by the share of the team's year actually scored.
      --
      -- Adding completion as a fourth weight was tried first and does
      -- not work, and the dry run is why: with an additive formula the
      -- other components are still computed from whatever tiny sample
      -- exists, so a manager who had scored ONE of eighty-one months
      -- came first on turnaround and a team band drawn from that single
      -- month. No set of weights fixes that, because the problem is not
      -- how much completion counts -- it is that the other three numbers
      -- mean nothing without it. A fortnight's turnaround on 1% of your
      -- team is not a fast manager, it is an unmeasured one.
      --
      -- So coverage scales the whole figure: 80% of the work done well
      -- beats 1% done quickly, and a manager at half completion carries
      -- half their quality into the ranking.
      case
        when (case when m.sub_mark  is null then 0 else 0.1 end)
           + (case when m.comp_mark is null then 0 else 0.2 end)
           + (case when m.team_mark is null then 0 else 0.7 end) = 0
        then null
        else round(100 * (
               coalesce(m.sub_mark  * 0.1, 0)
             + coalesce(m.comp_mark * 0.2, 0)
             + coalesce(m.team_mark * 0.7, 0)
             ) / (
               (case when m.sub_mark  is null then 0 else 0.1 end)
             + (case when m.comp_mark is null then 0 else 0.2 end)
             + (case when m.team_mark is null then 0 else 0.7 end)
             ), 1)
      end as overall
    from mgr_marked m
  ),
  mgr_ranked as (
    select
      ms.*,
      rank() over (order by ms.overall desc nulls last) as m_rank,
      count(*) over ()                                  as m_of,
      -- How many of those managers have a mark at all. The rank is
      -- taken among these; everyone else ties on nulls last.
      count(*) filter (where ms.overall is not null) over () as m_measured
    from mgr_scored ms
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
    tm_days::int,
    mgr_days::int,
    nullif(pol->>'starts_from', '')::date,
    r.job_b::int,
    r.core_b::int,
    round(r.rank_v, 2),
    m.overall,
    -- The two figures the bands came from. Two decimals, because this
    -- is the panel somebody opens to answer a challenge: at one decimal
    -- 89.96 and 90.04 both read 90.0 and sit in different bands. The
    -- band itself is decided on the full-precision average above,
    -- never on this.
    round(r.job_pct, 2),
    round(r.core_pct, 2),
    -- The team average on the 1-5 slab, and the number of scored
    -- reportees behind it. Two decimals: the mark is 25 points per
    -- band, so a whole decimal place is worth 2.5 of the 70 and
    -- rounding to one would not add up on screen.
    round(m.team_v, 2),
    m.team_n::int,
    m.m_measured::int
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $function$

;

-- The grants the dropped function carried.
grant execute on function public.kpi_ranking(uuid, text) to authenticated;
grant execute on function public.kpi_ranking(uuid, text) to service_role;


-- ---------------------------------------------------------------------
-- Self-test: the field a manager was ranked in is real -- at least as
-- big as their own position, never bigger than the roll, and present
-- for everybody who has a mark.
-- ---------------------------------------------------------------------
do $$
declare
  seen integer;
  bad  integer;
begin
  select count(*), count(*) filter (
      where (k.mgr_overall is not null
             and (k.mgr_measured is null
                  or k.mgr_measured < k.mgr_rank
                  or k.mgr_measured > k.mgr_of))
         -- Nothing measured anywhere would make the whole column a lie.
         or (k.mgr_rank is not null and coalesce(k.mgr_measured, 0) < 1))
    into seen, bad
  from (
    select e.id
    from employees e
    where e.is_active
      and exists (select 1 from employees r
                  where r.reporting_manager_id = e.id and r.is_active)
    limit 40
  ) sample
  cross join lateral kpi_ranking(sample.id, null) k;

  if bad > 0 then
    raise exception '% of % manager row(s) ranked against a field that does not exist', bad, seen;
  end if;

  raise notice '0119 self-test passed (% managers: each rank inside the field it was taken in)', seen;
end $$;
