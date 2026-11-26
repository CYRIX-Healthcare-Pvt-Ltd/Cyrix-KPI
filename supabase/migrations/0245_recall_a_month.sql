-- =====================================================================
-- Cyrix KPI  ·  0245  ·  Recall a submitted month
--
-- The user, 2 Nov: a month sent in by mistake comes back as a draft, "if
-- manager didnt start scoring, ie not even draft" — anything the manager has
-- saved on it, a figure, a rating or a remark, and Recall is gone. Before the
-- last day to submit only, as submitting is. The manager's list of months to
-- score is read from the months themselves, so it drops off there on its own.
-- =====================================================================

-- Whether the manager has put anything on the month yet.
create or replace function kpi_manager_started(p_submission_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kpi_submissions s where s.id = p_submission_id
                 and (s.manager_scored_at is not null or nullif(btrim(coalesce(s.manager_remarks, '')), '') is not null))
      or exists (select 1 from kpi_submission_items i where i.submission_id = p_submission_id
                 and (i.manager_score is not null or i.manager_achieved is not null
                      or nullif(btrim(coalesce(i.manager_remarks, '')), '') is not null))
      or exists (select 1 from core_value_ratings r where r.submission_id = p_submission_id
                 and (r.manager_rating is not null or nullif(btrim(coalesce(r.manager_remarks, '')), '') is not null))
      or exists (select 1 from core_value_part_ratings p where p.submission_id = p_submission_id
                 and p.manager_rating is not null)
$$;
revoke all on function kpi_manager_started(uuid) from public, anon;
grant execute on function kpi_manager_started(uuid) to authenticated;

-- Whether the button shows: the screen asks, the recall checks again.
create or replace function kpi_can_recall(p_submission_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kpi_submissions s
                 where s.id = p_submission_id and s.employee_id = current_employee_id()
                   and s.status = 'submitted'
                   and coalesce(now() < kpi_deadline_at(s.period_month, 'tm'), true))
     and not kpi_manager_started(p_submission_id)
$$;
revoke all on function kpi_can_recall(uuid) from public, anon;
grant execute on function kpi_can_recall(uuid) to authenticated;

create or replace function kpi_recall(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id for update;
  if not found or s.employee_id <> current_employee_id() then raise exception 'You can recall only your own month'; end if;
  if s.status <> 'submitted' then raise exception 'This month is no longer waiting for your manager'; end if;
  if now() >= kpi_deadline_at(s.period_month, 'tm') then
    raise exception '%', kpi_deadline_message(s.period_month, 'tm');
  end if;
  if kpi_manager_started(p_submission_id) then
    raise exception 'Your manager has started scoring this month, so it cannot be recalled';
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions set status = 'draft', self_submitted_at = null
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'recalled', '{}'::jsonb);
  return s;
end $$;
revoke all on function kpi_recall(uuid) from public, anon;
grant execute on function kpi_recall(uuid) to authenticated;
