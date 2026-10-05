-- =====================================================================
-- Cyrix KPI  ·  0144  ·  A month filed on the old KPI comes back with the new
--
-- A KPI change runs request → manager → HR (review_kpi_revision), which
-- puts the KPI back to draft; the person edits it and sends it, and its
-- approval (approve_assignment) makes it the live one. Months still in
-- draft or returned then take the new KPI (refresh_open_submissions).
--
-- A month already submitted on the old KPI did not. The user, 5 Oct: "if
-- i submitted sept kpi manager didnt approve, then i change rqst kpi, then
-- edited and submitted, then all approved. still sept month already
-- submitted should be cleared ... now we are doing, deletion request then
-- hr approve then only able to do again".
--
-- Now, when an approval finishes an approved change, a month that was
-- submitted before HR approved the change and that the manager has not
-- reviewed comes back to the person as a draft, from the month the new
-- KPI starts. It takes the new KPI with the other open months, and what
-- they typed stays wherever the KRA stays; they look it over and submit
-- it again. Months the manager has reviewed, and final months, keep what
-- they were assessed on. Written to the audit log as months_back_to_draft.
--
-- Only approve_assignment changes; HR's bulk assignment and template tools
-- are not touched, so they still never pull a submitted month back.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.approve_assignment(p_assignment_id uuid)
 RETURNS kpi_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a  kpi_assignments%rowtype;
  v  record;
  rev_at     timestamptz;
  last_ok    timestamptz;
  prev_write text;
  back       jsonb;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  if not (manages_employee(a.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can approve this KPI';
  end if;
  if a.status <> 'pending_approval' then
    raise exception 'Only a KPI awaiting approval can be approved (current: %)', a.status;
  end if;

  select * into v from validate_assignment(p_assignment_id);
  if not v.ok then raise exception '%', v.message; end if;

  -- Does this approval finish a change HR approved (review_kpi_revision)?
  -- It does when the change was decided after the KPI was last approved.
  select max(r.hr_decided_at) into rev_at
  from kpi_revision_requests r
  where r.assignment_id = p_assignment_id and r.status = 'approved';
  select max(l.created_at) into last_ok
  from audit_log l
  where l.entity_type = 'kpi_assignment' and l.entity_id = p_assignment_id and l.action = 'approved';

  update kpi_assignments
  set status = 'active', approved_at = now(), approved_by = current_employee_id()
  where id = p_assignment_id
  returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'approved', '{}'::jsonb);

  -- A month the person submitted on the KPI the change replaced, and the
  -- manager has not reviewed, comes back to them as a draft and takes the
  -- new KPI with the open months below; what they typed stays wherever
  -- the KRA stays. Only from the month the new KPI starts, and never a
  -- month the manager has reviewed or that is final. Before 0144 it took
  -- a deletion request and HR's approval (the user, 5 Oct).
  if rev_at is not null and rev_at > coalesce(last_ok, '-infinity'::timestamptz) then
    prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
    perform set_config('cyrix.system_write', 'on', true);
    with moved as (
      update kpi_submissions s
      set status = 'draft', self_submitted_at = null
      where s.assignment_id = p_assignment_id
        and s.status = 'submitted'
        and s.self_submitted_at < rev_at
        and (a.starts_from is null or s.period_month >= date_trunc('month', a.starts_from)::date)
      returning s.period_month
    )
    select jsonb_agg(to_char(period_month, 'Mon-YY') order by period_month) into back from moved;
    perform set_config('cyrix.system_write', prev_write, true);
    if back is not null then
      perform log_audit('kpi_assignment', p_assignment_id, 'months_back_to_draft',
        jsonb_build_object('months', back, 'why', 'submitted on the KPI a revision replaced, not yet reviewed by the manager'));
    end if;
  end if;
  -- Same reason as the upload path: approving is the other way a KPI
  -- becomes the live one.
  perform refresh_open_submissions(p_assignment_id);

  return a;
end $function$;
