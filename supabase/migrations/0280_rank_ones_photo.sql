-- =====================================================================
-- Cyrix KPI  ·  0280  ·  The Rank 1s list carries each person's photo
--
-- The portal's Rank 1s pop-up shows each Rank 1's round profile photo in
-- place of the crown, the crown in a round for those without one, and a
-- press opens the photo with "Oct-26 Rank 1 in X's team" (the user, 11 Nov).
-- The photo is the employee row's own avatar (a small data URL), so it
-- comes with the list. Same rules as 0277; only the avatar column is new.
-- =====================================================================

drop function if exists public.kpi_rank_ones(date);
create function public.kpi_rank_ones(p_month date default null)
returns table (manager_name text, manager_ecode text, full_name text, ecode text, designation text, function_name text, period_month date, avatar text)
language sql stable security definer set search_path = public as $$
  with mo as (
    select coalesce(p_month, (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) - interval '1 month')::date) m
  ), base as (
    select e.reporting_manager_id mgr, e.id, e.ecode, e.full_name, e.designation, e.function_name, e.avatar,
           s.final_total_score sc, s.final_job_role_score js,
           (select i.final_score from kpi_submission_items i where i.submission_id = s.id and i.section = 'job_role'
             order by i.weightage desc, i.sort_order limit 1) kr,
           (select avg(y.final_total_score) from kpi_submissions y where y.employee_id = s.employee_id and y.financial_year = s.financial_year
             and y.status in ('scored', 'finalized') and y.final_total_score is not null) ya
    from kpi_submissions s join employees e on e.id = s.employee_id, mo
    where public.portal_rank_ones_on()
      and s.period_month = mo.m and s.status in ('scored', 'finalized') and s.final_total_score is not null
      and e.is_active and e.reporting_manager_id is not null
      and upper(e.ecode) not in ('E6666', 'E7777', 'E8888', 'E9999') and e.full_name not ilike '%- test%'
  ), ranked as (
    select b.*, count(*) over (partition by b.mgr) n,
           row_number() over (partition by b.mgr order by b.sc desc, b.js desc nulls last, b.kr desc nulls last, b.ya desc nulls last, b.full_name) rk
    from base b
  )
  select m.full_name, m.ecode, r.full_name, r.ecode, r.designation, r.function_name::text, (select mo.m from mo), r.avatar
  from ranked r join employees m on m.id = r.mgr
  where r.rk = 1 and r.n > 1
  order by m.full_name, r.full_name
$$;
revoke all on function public.kpi_rank_ones(date) from public, anon;
grant execute on function public.kpi_rank_ones(date) to authenticated;
