-- The year's scores for everybody below one person.
--
-- team_subtree (0082) answers "where does my division stand this month",
-- which is what a screen needs. An export is the other question: every
-- month of the year, for everybody, in one file.
--
-- It cannot be assembled from the tables by the person asking. The row
-- policy on kpi_submissions is manages_employee(), which is a single hop
-- -- so a divisional manager reading it directly gets their forty-one
-- direct reports and none of the hundred and forty-six below them, and
-- the file would be quietly short rather than refused.
--
-- Same ancestry check as team_subtree, for the same reason: this is a
-- controlled read down one branch, not a general widening of who may see
-- whose scores.
create or replace function public.team_subtree_scores(
  p_fy text,
  p_root uuid default null,
  p_deep boolean default true
)
returns table (
  employee_id uuid,
  ecode text,
  full_name text,
  designation text,
  department text,
  depth int,
  period_month date,
  status text,
  self_job_role_score numeric,
  self_esms_score numeric,
  self_core_score numeric,
  self_total_score numeric,
  final_job_role_score numeric,
  final_esms_score numeric,
  final_core_score numeric,
  final_total_score numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with recursive me as (
    select id from employees where auth_user_id = auth.uid()
  ),
  root as (
    select coalesce(p_root, (select id from me)) as id
  ),
  allowed as (
    select (
      (select id from root) = (select id from me)
      or public.is_above((select id from root))
      or public.is_hr_admin()
      or public.is_sw_admin()
    ) as ok
  ),
  tree as (
    select e.id, 1 as depth
    from employees e
    where e.reporting_manager_id = (select id from root)
      and e.is_active
      and (select ok from allowed)
    union all
    select e.id, t.depth + 1
    from employees e
    join tree t on e.reporting_manager_id = t.id
    where e.is_active
      -- Stops at the first rung when the caller asked for direct reports
      -- only. Pruned in the recursion rather than filtered afterwards, so
      -- a shallow ask does not walk a division to throw it away.
      and p_deep
  )
  select
    e.id, e.ecode, e.full_name, e.designation, e.department, t.depth,
    s.period_month, s.status,
    s.self_job_role_score, s.self_esms_score, s.self_core_score, s.self_total_score,
    s.final_job_role_score, s.final_esms_score, s.final_core_score, s.final_total_score
  from tree t
  join employees e on e.id = t.id
  left join kpi_submissions s
    on s.employee_id = e.id and s.financial_year = p_fy
  order by t.depth, e.full_name, s.period_month;
$function$;

revoke all on function public.team_subtree_scores(text, uuid, boolean) from public, anon;
grant execute on function public.team_subtree_scores(text, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
