-- A manager can see the whole line below them, not just the first rung.
--
-- The org runs seven levels deep, and until now a manager could see
-- exactly one: employees_read allows direct reports, manages_employee()
-- tests one hop. So a divisional manager with forty reports, eight of
-- whom manage teams of their own, could see the eight and none of the
-- people under them -- could not tell whether a branch of their own
-- division had submitted anything, let alone score it.
--
-- Read only, and through one function rather than by loosening the
-- tables. The row policies stay exactly as they are: this widens what a
-- manager can be shown on their own team screens, and nothing else. A
-- definer function with an explicit ancestry check is a door with a lock
-- on it; a looser policy is a door taken off its hinges.

/**
 * Is the caller somewhere above this person in the reporting line?
 *
 * Walks up from the person rather than down from the caller: an employee
 * has one manager and a manager has forty reports, so upwards is one row
 * per level and downwards is the whole subtree. Seven hops at most.
 */
create or replace function public.is_above(p_employee_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  with recursive line as (
    select id, reporting_manager_id from employees where id = p_employee_id
    union all
    select e.id, e.reporting_manager_id
    from employees e join line l on e.id = l.reporting_manager_id
  )
  select exists (
    select 1 from line l
    join employees me on me.id = l.reporting_manager_id
    where me.auth_user_id = auth.uid()
  );
$function$;

/**
 * Everybody below one person, with where each of them stands this month.
 *
 * `p_root` null means the caller. Naming somebody else is how the team
 * screen drills into a report's own team, and is allowed only when the
 * caller is above them -- so a manager can walk down their own branch and
 * nowhere else.
 *
 * `depth` is how far below the root each person sits, so the caller can
 * ask for the first rung or the whole line without a second query.
 * `direct_reports` is what decides whether a row can be drilled into
 * further, computed here because the caller cannot see far enough down to
 * count it themselves.
 */
create or replace function public.team_subtree(
  p_fy text,
  p_month date,
  p_root uuid default null
)
returns table (
  employee_id uuid,
  ecode text,
  full_name text,
  designation text,
  avatar text,
  reporting_manager_id uuid,
  depth int,
  direct_reports bigint,
  assignment_status text,
  submission_status text,
  final_total_score numeric,
  self_total_score numeric,
  final_job_role_score numeric,
  final_core_score numeric,
  final_esms_score numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
  -- RECURSIVE leads the whole chain, not just the member that recurses:
  -- Postgres reads it as a property of the WITH clause.
  with recursive me as (
    select id from employees where auth_user_id = auth.uid()
  ),
  root as (
    select coalesce(p_root, (select id from me)) as id
  ),
  allowed as (
    -- The caller themselves, anybody above them, HR and the software
    -- admin. Everyone else gets an empty set rather than an error: this
    -- is read on page load, and a screen that throws is worse than a
    -- screen that shows nothing.
    select (
      (select id from root) = (select id from me)
      or public.is_above((select id from root))
      or public.is_hr_admin()
      or public.is_sw_admin()
    ) as ok
  ),
  tree as (
    select e.id, e.reporting_manager_id, 1 as depth
    from employees e
    where e.reporting_manager_id = (select id from root)
      and e.is_active
      and (select ok from allowed)
    union all
    select e.id, e.reporting_manager_id, t.depth + 1
    from employees e
    join tree t on e.reporting_manager_id = t.id
    where e.is_active
  )
  select
    e.id,
    e.ecode,
    e.full_name,
    e.designation,
    e.avatar,
    e.reporting_manager_id,
    t.depth,
    (select count(*) from employees g where g.reporting_manager_id = e.id and g.is_active),
    a.status,
    s.status,
    s.final_total_score,
    s.self_total_score,
    s.final_job_role_score,
    s.final_core_score,
    s.final_esms_score
  from tree t
  join employees e on e.id = t.id
  left join kpi_assignments a
    on a.employee_id = e.id and a.financial_year = p_fy
  left join kpi_submissions s
    on s.employee_id = e.id and s.financial_year = p_fy and s.period_month = p_month
  order by t.depth, e.full_name;
$function$;

revoke all on function public.is_above(uuid) from public, anon;
revoke all on function public.team_subtree(text, date, uuid) from public, anon;
grant execute on function public.is_above(uuid) to authenticated;
grant execute on function public.team_subtree(text, date, uuid) to authenticated;

notify pgrst, 'reload schema';
