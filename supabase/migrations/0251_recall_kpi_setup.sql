-- =====================================================================
-- Cyrix KPI  ·  0251  ·  Recall the year's KPI before the manager approves
--
-- The user, 5 Nov: "in kpi we need 1 recall option, ie set up my kpi,
-- there before manager approves we need recall". Like a month's Recall
-- (0245): the person's own KPI, while it waits on the manager, comes back
-- as a draft and leaves the manager's list until it is submitted again.
-- Once approved or sent back, it is not waiting any more.
-- =====================================================================

create or replace function kpi_assignment_recall(p_assignment_id uuid)
returns kpi_assignments
language plpgsql security definer set search_path = public as $$
declare a kpi_assignments%rowtype;
begin
  select * into a from kpi_assignments where id = p_assignment_id for update;
  if not found or a.employee_id <> current_employee_id() then raise exception 'You can recall only your own KPI'; end if;
  if a.status <> 'pending_approval' then
    raise exception '%', case a.status
      when 'active' then 'Your manager has already approved it'
      when 'rejected' then 'Your manager has sent it back — change it and submit again'
      else 'It is not waiting for your manager' end;
  end if;

  update kpi_assignments set status = 'draft', submitted_at = null, submitted_by = null
  where id = p_assignment_id returning * into a;

  perform log_audit('kpi_assignment', p_assignment_id, 'recalled', '{}'::jsonb);
  return a;
end $$;

revoke all on function kpi_assignment_recall(uuid) from public, anon;
grant execute on function kpi_assignment_recall(uuid) to authenticated;
