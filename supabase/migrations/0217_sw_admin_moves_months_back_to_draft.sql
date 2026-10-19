-- =====================================================================
-- Cyrix KPI  ·  0217  ·  SW Admin moves a month back to draft
--
-- The user, 19 Oct: "in edit kpi, i need 1 more option, ie draft, select
-- month or full month, ie they may have submitted, but i need to make it
-- draft ie emp before submitting stage."
--
-- A month back to draft is where it stood before the team member sent it:
-- their own figures, remarks and core value ratings stay, so they correct
-- and send again; everything after the sending is cleared — the manager's
-- figures, ratings and remarks, a send-back and its reason, the reduced
-- score reason and a missed last day. An open score query on it is closed,
-- since the score it asks about is gone.
--
-- A month whose last day to submit has passed is refused: as a draft it
-- would be scored 0 at once. Moving the last day later in Timing opens it.
-- =====================================================================

-- Edit a KPI lists the person's months, so one or all can be chosen.
create or replace function public.admin_kpi_for(p_ecode text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  e  employees%rowtype;
  a  kpi_assignments%rowtype;
  fy text := (select code from financial_years where is_current limit 1);
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can edit somebody''s KPI here';
  end if;
  select * into e from employees where upper(ecode) = upper(btrim(coalesce(p_ecode, '')));
  if not found then
    raise exception 'There is nobody with the code %', upper(btrim(coalesce(p_ecode, '')));
  end if;
  select * into a from kpi_assignments
   where employee_id = e.id and financial_year = fy and status in ('active', 'pending_approval')
   order by created_at desc limit 1;
  return jsonb_build_object(
    'fy', fy,
    'employee', jsonb_build_object('id', e.id, 'ecode', e.ecode, 'full_name', e.full_name,
                                   'designation', e.designation, 'is_active', e.is_active),
    'assignment', case when a.id is null then null else jsonb_build_object(
        'id', a.id, 'status', a.status, 'job_role_weight', a.job_role_weight,
        'esms', coalesce(a.esms_weight, 0) > 0,
        'template', (select name from kpi_templates where id = a.source_template_id)) end,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
                         from kpi_assignment_items i
                        where i.assignment_id = a.id and i.section = 'job_role'), '[]'::jsonb),
    'months', coalesce((select jsonb_object_agg(status, n)
                          from (select status, count(*)::int n from kpi_submissions
                                 where assignment_id = a.id group by status) x), '{}'::jsonb),
    'month_list', coalesce((select jsonb_agg(jsonb_build_object(
                              'month', s.period_month, 'status', s.status,
                              'last_day_passed', coalesce(now() >= kpi_deadline_at(s.period_month, 'tm'), false))
                            order by s.period_month)
                              from kpi_submissions s where s.assignment_id = a.id), '[]'::jsonb));
end $function$;


create or replace function public.admin_kpi_to_draft(p_assignment_id uuid, p_months date[] default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r      record;
  late   text;
  moved  text[] := '{}';
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can move a month back to draft';
  end if;

  -- Null is every month of the KPI; otherwise the months chosen.
  select string_agg(to_char(s.period_month, 'Mon-YY'), ', ' order by s.period_month) into late
  from kpi_submissions s
  where s.assignment_id = p_assignment_id and s.status <> 'draft'
    and (p_months is null or s.period_month = any (select date_trunc('month', m)::date from unnest(p_months) m))
    and now() >= kpi_deadline_at(s.period_month, 'tm');
  if late is not null then
    raise exception 'The last day to submit % has passed, so as a draft it would be scored 0. Move the last day later in Timing first.', late;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  for r in
    select s.id, s.period_month, s.status, s.mgr_total_score, s.final_total_score, s.deadline_outcome
    from kpi_submissions s
    where s.assignment_id = p_assignment_id and s.status <> 'draft'
      and (p_months is null or s.period_month = any (select date_trunc('month', m)::date from unnest(p_months) m))
    order by s.period_month
  loop
    update core_value_ratings set manager_rating = null, manager_remarks = null where submission_id = r.id;
    update kpi_submission_items set manager_achieved = null, manager_score = null, manager_remarks = null, final_score = null
     where submission_id = r.id;
    update kpi_score_queries
       set status = 'answered', answered_at = now(), answered_by = current_employee_id(),
           manager_response = 'The month went back to draft.', score_changed = false
     where submission_id = r.id and status = 'open';
    -- Again: a trigger above may have put it back.
    perform set_config('cyrix.system_write', 'on', true);
    update kpi_submissions
       set status = 'draft', self_submitted_at = null, manager_scored_at = null, finalized_at = null,
           returned_at = null, return_reason = null, manager_remarks = null, score_cut_reason = null,
           deadline_outcome = null, outcome_from_status = null
     where id = r.id;
    perform recompute_submission_totals(r.id);
    perform set_config('cyrix.system_write', 'on', true);
    perform log_audit('kpi_submission', r.id, 'sw_admin_to_draft', jsonb_build_object(
      'was', r.status, 'mgr_total', r.mgr_total_score, 'final_total', r.final_total_score, 'outcome', r.deadline_outcome));
    moved := moved || to_char(r.period_month, 'Mon-YY');
  end loop;
  perform set_config('cyrix.system_write', 'off', true);

  return jsonb_build_object('months', cardinality(moved), 'list', to_jsonb(moved));
end $function$;

revoke all on function public.admin_kpi_to_draft(uuid, date[]) from public, anon;
grant execute on function public.admin_kpi_to_draft(uuid, date[]) to authenticated;
