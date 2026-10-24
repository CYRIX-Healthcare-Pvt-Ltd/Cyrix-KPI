-- 0219 · the KPI export names each person's reporting manager
-- The user, 24 Oct: "add reporting manager also in summary report, ie against each emp". kpi_export_data (0218)
-- reaches the whole line below the caller, so it names each person's manager too: the whole-team exports build their
-- people from team_subtree_scores, which carries no manager.
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
    'ratings', coalesce((select jsonb_agg(to_jsonb(r)) from core_value_ratings r join subs s on s.id = r.submission_id), '[]'::jsonb),
    'managers', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', m.full_name, 'ecode', m.ecode))
      from employees e join ok on ok.id = e.id left join employees m on m.id = e.reporting_manager_id), '[]'::jsonb)
  )
$function$;
