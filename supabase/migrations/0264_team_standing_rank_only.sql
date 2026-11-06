-- Cyrix KPI  ·  0264  ·  Team standing without the others' scores
--
-- The user, 6 Nov: "i think it is bad to show everyone's score, so just show the rank and that line graph vs me".
-- kpi_team_standing (0262) now gives everybody's rank but only my own score; the team's average for each month and
-- for the year comes in team_avg, for my line against the team.
drop function if exists public.kpi_team_standing(text);
create function public.kpi_team_standing(p_fy text)
returns table (employee_id uuid, ecode text, full_name text, designation text, is_me boolean, manager_name text,
               period_month date, score numeric, team_rank integer, team_of integer, months integer, team_avg numeric)
language plpgsql stable security definer set search_path = public as $$
declare me employees;
begin
  select * into me from employees where id = current_employee_id();
  if me.id is null or me.reporting_manager_id is null then return; end if;
  return query
  with team as (
    select e.* from employees e where e.reporting_manager_id = me.reporting_manager_id and e.is_active
  ), monthly as (
    select s.employee_id emp, s.period_month mo, s.final_total_score sc,
           100.0 * s.final_job_role_score / nullif(a.job_role_weight, 0) jp,
           case when s.final_core_score is null then null else
             100.0 * (s.final_core_score + coalesce(s.final_esms_score, 0))
             / nullif(a.core_values_weight + coalesce(a.esms_weight, 0), 0) end cp
    from kpi_submissions s
    join team t on t.id = s.employee_id
    left join kpi_assignments a on a.employee_id = s.employee_id and a.financial_year = s.financial_year
    where s.financial_year = p_fy and s.status in ('scored', 'finalized') and s.final_total_score is not null
  ), rows_ as (
    select emp, mo, sc, jp, cp, 1 n from monthly
    union all
    select emp, null::date, avg(sc), avg(jp), avg(cp), count(*)::int from monthly group by emp
  ), banded as (
    select r.*, kpi_rating(r.jp) jb, kpi_rating(r.cp) cb,
      case when kpi_rating(r.jp) is null and kpi_rating(r.cp) is null then null
           when kpi_rating(r.jp) is null then kpi_rating(r.cp)::numeric
           when kpi_rating(r.cp) is null then kpi_rating(r.jp)::numeric
           else 0.8 * kpi_rating(r.jp) + 0.2 * kpi_rating(r.cp) end rv
    from rows_ r
  ), ranked as (
    select b.*,
      rank() over (partition by b.mo order by b.sc desc) rk,
      count(*) over (partition by b.mo) cnt,
      avg(b.sc) over (partition by b.mo) av
    from banded b
  )
  select t.id, t.ecode, t.full_name, t.designation, t.id = me.id, m.full_name,
         k.mo, case when t.id = me.id then round(k.sc, 2) end, k.rk::int, k.cnt::int, k.n::int, round(k.av, 2)
  from team t
  join employees m on m.id = t.reporting_manager_id
  left join ranked k on k.emp = t.id
  order by t.full_name, k.mo nulls first;
end $$;
revoke all on function public.kpi_team_standing(text) from public, anon;
grant execute on function public.kpi_team_standing(text) to authenticated;
