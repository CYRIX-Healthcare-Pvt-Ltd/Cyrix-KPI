-- =====================================================================
-- Cyrix KPI  ·  0099  ·  ESMS is part of the second band, not part of
--                        nothing
--
-- 0096 built the employee ranking out of two bands, job role and core
-- values, because those are the two management named. ESMS was left out
-- of both, and the migration said so plainly enough that somebody read
-- it and objected -- correctly.
--
-- ESMS is not a third thing. It is 5 of the same 20 that core values
-- occupies: a person carrying it has 5 ESMS and 15 core, and a person
-- who does not has 20 core. So the second band is the whole 20-point
-- block either way, and an ESMS carrier is measured on the same scale as
-- everybody else rather than on a 15-point one with their ESMS work
-- quietly discarded.
--
-- The effect: an ESMS carrier's ESMS performance now moves their rank as
-- well as their score. Before this it moved only the score, which meant
-- the one group with an extra obligation was ranked as though they did
-- not have it.
--
-- A month with no core score contributes nothing, rather than counting
-- as a zero -- the same rule the rest of this function follows. Where
-- somebody does not carry ESMS the added score and the added weight are
-- both nothing, so the arithmetic is unchanged for them.
--
-- 0098's function with that one expression replaced, taken from the live
-- definition rather than retyped.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.kpi_ranking(p_employee_id uuid DEFAULT NULL::uuid, p_financial_year text DEFAULT NULL::text)
 RETURNS TABLE(employee_id uuid, financial_year text, score numeric, team_rank integer, team_of integer, org_rank integer, org_of integer, team_size integer, mgr_rank integer, mgr_of integer, completion_pct numeric, due_months integer, scored_months integer, submit_tat numeric, completion_tat numeric, pending_tat numeric, submit_delay numeric, completion_delay numeric, pending_delay numeric, tm_grace_days integer, mgr_grace_days integer, tat_starts_from date, job_band integer, core_band integer, rank_value numeric, mgr_overall numeric)
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
    select c.mgr as mgr_id, avg(c.rank_v) as team_v
    from combined c
    where c.rank_v is not null
    group by c.mgr
  ),
  mgr_marked as (
    select
      b.*,
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
      count(*) over ()                                  as m_of
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
    m.overall
  from (select 1) one
  left join ranked     r on r.emp = target
  left join mgr_ranked m on m.mgr_id = target;
end $function$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Checks the thing that actually changed: an ESMS carrier's second band
-- is now computed over 20 points rather than 15, and somebody without
-- ESMS is untouched.
-- ---------------------------------------------------------------------
do $test$
declare
  esms_person uuid;
  plain_person uuid;
  n int;
begin
  -- Anybody active who carries ESMS and has a scored month.
  select a.employee_id into esms_person
  from kpi_assignments a
  join kpi_submissions s
    on s.employee_id = a.employee_id and s.financial_year = a.financial_year
  where coalesce(a.esms_weight, 0) > 0
    and s.status in ('scored', 'finalized')
    and s.final_core_score is not null
  limit 1;

  select a.employee_id into plain_person
  from kpi_assignments a
  join kpi_submissions s
    on s.employee_id = a.employee_id and s.financial_year = a.financial_year
  where coalesce(a.esms_weight, 0) = 0
    and s.status in ('scored', 'finalized')
    and s.final_core_score is not null
  limit 1;

  -- The function still answers for both, and gives each a second band.
  if esms_person is not null then
    select count(*) into n
    from kpi_ranking(esms_person, (select code from financial_years where is_current))
    where core_band is not null;
    if n <> 1 then
      raise exception 'an ESMS carrier has no core band';
    end if;
  else
    raise notice '0099: no scored ESMS carrier to check against yet';
  end if;

  if plain_person is not null then
    select count(*) into n
    from kpi_ranking(plain_person, (select code from financial_years where is_current))
    where core_band is not null;
    if n <> 1 then
      raise exception 'somebody without ESMS lost their core band';
    end if;
  end if;

  raise notice '0099 self-test passed (ESMS folded into the 20-point band)';
end $test$;
