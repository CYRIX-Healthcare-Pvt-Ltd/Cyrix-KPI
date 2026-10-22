-- 0218 · the Excel exports read the whole line below
--
-- The user, 22 Oct: My Team → Export to Excel → Summary report failed with 'invalid input syntax for type
-- uuid: "undefined"'. The summary works out each month's actual job role score from its KPI rows (19 Oct),
-- by submission id, and the whole-line scores (team_subtree_scores) carry no submission id. Behind that, the
-- table rules let a manager read only their direct reports' submissions and rows, so for anyone further down
-- the summary's actual would have fallen back to the capped score, and the zip's workbooks come out empty.
--
-- One reader for both exports: for the people asked about, the year's submissions, their KPI rows, the
-- assignments' core value weights and the core value ratings — the caller's own, anyone below them in the
-- line, or anyone at all for HR and SW Admin. Asked a few dozen people at a time by the page.

create or replace function public.kpi_export_data(p_people uuid[], p_fy text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with ok as (
    select e.id from employees e
    where e.id = any(p_people)
      and (e.id = current_employee_id() or is_above(e.id) or is_hr_admin() or is_sw_admin())
  ), subs as (
    select s.* from kpi_submissions s join ok on ok.id = s.employee_id where s.financial_year = p_fy
  )
  select jsonb_build_object(
    'submissions', coalesce((select jsonb_agg(to_jsonb(s) order by s.employee_id, s.period_month) from subs s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.submission_id, i.sort_order)
      from kpi_submission_items i join subs s on s.id = i.submission_id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'core_self_rating', a.core_self_rating, 'core_value_weights', a.core_value_weights))
      from kpi_assignments a where a.id in (select assignment_id from subs)), '[]'::jsonb),
    'ratings', coalesce((select jsonb_agg(to_jsonb(r)) from core_value_ratings r join subs s on s.id = r.submission_id), '[]'::jsonb)
  )
$function$;

revoke all on function public.kpi_export_data(uuid[], text) from public, anon;
grant execute on function public.kpi_export_data(uuid[], text) to authenticated;
