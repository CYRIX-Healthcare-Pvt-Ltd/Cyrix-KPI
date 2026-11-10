-- =====================================================================
-- Cyrix KPI  ·  0273  ·  Request to open a month closed by a last day
--
-- The user, 10 Nov: "we need open request ... the hr should see why it was
-- closed is it manager or emp issue of tat". Whoever missed the last day
-- asks: the team member for a month not sent in (to the reporting manager,
-- then HR), the manager for a month not scored (straight to HR, as the
-- manager is the one asking). One request per month, a reason always.
-- HR approving opens the month for 3 days; a month not sent in then gives
-- the manager 3 days after that to score it. Missed again, it closes as
-- before: not sent in is 0, not scored keeps the team member's own score.
--
-- It rides on record_deletion_requests (kind 'reopen'), so the badge, the
-- bell, the Record requests page and HR's queue already count it.
-- =====================================================================

alter table public.record_deletion_requests
  add column if not exists kind text not null default 'delete',
  add column if not exists closed_as text;
alter table public.record_deletion_requests drop constraint if exists record_deletion_requests_kind_check;
alter table public.record_deletion_requests add constraint record_deletion_requests_kind_check
  check (kind in ('delete', 'reopen') and (kind = 'delete' or closed_as in ('not_submitted', 'not_scored')));
-- Once per month, whatever became of it.
create unique index if not exists idx_reopen_once
  on public.record_deletion_requests(submission_id) where kind = 'reopen';

alter table public.kpi_submissions
  add column if not exists reopen_tm_until timestamptz,
  add column if not exists reopen_mgr_until timestamptz;

-- A month's last day with its own "open until" (from a request) counted: the later of the two.
create or replace function public.kpi_sub_deadline(p_period_month date, p_side text, p_reopen timestamptz)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when d is null then null else greatest(d, p_reopen) end
  from (select kpi_deadline_at(p_period_month, p_side) as d) x
$$;
revoke all on function public.kpi_sub_deadline(date, text, timestamptz) from public, anon;
grant execute on function public.kpi_sub_deadline(date, text, timestamptz) to authenticated;

create or replace function public.request_kpi_reopen(p_submission_id uuid, p_reason text)
returns record_deletion_requests
language plpgsql security definer set search_path = public as $$
declare
  s kpi_submissions%rowtype;
  r record_deletion_requests%rowtype;
  me uuid := current_employee_id();
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Month not found'; end if;
  if s.deadline_outcome is null then
    raise exception 'Only a month closed by a last day can be opened';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if s.deadline_outcome = 'not_scored' and not manages_employee(s.employee_id) then
    raise exception 'The manager asks to open a month that was not scored';
  end if;
  if s.deadline_outcome = 'not_submitted' and s.employee_id is distinct from me then
    raise exception 'The team member asks to open a month that was not sent in';
  end if;
  if exists (select 1 from record_deletion_requests where submission_id = s.id and kind = 'reopen') then
    raise exception 'A request to open this month has already been made';
  end if;

  if s.deadline_outcome = 'not_scored' then
    insert into record_deletion_requests
      (submission_id, employee_id, period_month, requested_by, reason, kind, closed_as,
       status, manager_id, manager_decided_at)
    values (s.id, s.employee_id, s.period_month, me, trim(p_reason), 'reopen', s.deadline_outcome,
            'pending_hr', me, now())
    returning * into r;
  else
    insert into record_deletion_requests
      (submission_id, employee_id, period_month, requested_by, reason, kind, closed_as, manager_id)
    values (s.id, s.employee_id, s.period_month, me, trim(p_reason), 'reopen', s.deadline_outcome,
            (select reporting_manager_id from employees where id = s.employee_id))
    returning * into r;
  end if;

  perform log_audit('kpi_submission', s.id, 'reopen_requested',
                    jsonb_build_object('reason', trim(p_reason), 'closed_as', s.deadline_outcome));
  return r;
end $$;
revoke all on function public.request_kpi_reopen(uuid, text) from public, anon;
grant execute on function public.request_kpi_reopen(uuid, text) to authenticated;

-- HR has said yes: 3 days from today (to the end of the third day in India) for whoever missed.
create or replace function public.kpi_reopen_month(p_submission_id uuid, p_closed_as text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Kolkata')::date;
  three timestamptz := ((d + 4)::timestamp at time zone 'Asia/Kolkata');
  six   timestamptz := ((d + 7)::timestamp at time zone 'Asia/Kolkata');
begin
  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
     set reopen_tm_until  = case when p_closed_as = 'not_submitted' then three else reopen_tm_until end,
         reopen_mgr_until = case when p_closed_as = 'not_submitted' then six else three end
   where id = p_submission_id;
  perform settle_kpi_deadlines();  -- opens it again, as its last day is now ahead
  perform log_audit('kpi_submission', p_submission_id, 'reopened_on_request',
                    jsonb_build_object('closed_as', p_closed_as, 'tm_until', case when p_closed_as = 'not_submitted' then three end,
                                       'mgr_until', case when p_closed_as = 'not_submitted' then six else three end));
end $$;
revoke all on function public.kpi_reopen_month(uuid, text) from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.guard_core_part_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s kpi_submissions%rowtype; me uuid;
begin
  if system_write_active() or auth.uid() is null then return new; end if;
  if new.submission_id is distinct from old.submission_id or new.rating_id is distinct from old.rating_id
     or new.part_id is distinct from old.part_id or new.label is distinct from old.label
     or new.is_goal is distinct from old.is_goal or new.sort_order is distinct from old.sort_order then
    raise exception 'The parts of a core value are fixed for the month';
  end if;
  if is_hr_admin() then return new; end if;
  select * into s from kpi_submissions where id = new.submission_id;
  me := current_employee_id();
  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating then
      raise exception 'You cannot edit the manager rating';
    end if;
    if (new.self_rating is distinct from old.self_rating or new.goal is distinct from old.goal)
       and s.status not in ('draft', 'returned') then
      raise exception 'This month has been sent to your manager, so your core value ratings are locked';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status = 'submitted' and new.manager_rating is distinct from old.manager_rating
       and now() >= kpi_sub_deadline(s.period_month, 'manager', s.reopen_mgr_until) then
      raise exception '%', kpi_deadline_message(s.period_month, 'manager');
    end if;
    if new.self_rating is distinct from old.self_rating or new.goal is distinct from old.goal then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
    if s.status in ('scored', 'finalized') and old.manager_rating is not null and new.manager_rating is null then
      raise exception 'This month is already scored — a core value cannot be left unrated. Change the rating instead.';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_core_rating_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s  kpi_submissions%rowtype;
  me uuid;
begin
  if system_write_active() then
    return new;
  end if;

  -- No end user means a direct database connection: a migration, an admin
  -- script, or the service role. Those are trusted and bypass RLS anyway.
  -- An anonymous PostgREST caller never reaches here — every policy on this
  -- table is `to authenticated`, and anon holds no UPDATE grant.
  if auth.uid() is null then
    return new;
  end if;

  if new.self_points is distinct from old.self_points or new.manager_points is distinct from old.manager_points then
    raise exception 'A core value''s score comes from its parts';
  end if;

  select * into s from kpi_submissions where id = new.submission_id;
  if is_hr_admin() then return new; end if;
  me := current_employee_id();

  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager rating';
    end if;
    -- Their own rating and comment (0214), only while the month is theirs to fill in.
    if (new.self_rating is distinct from old.self_rating or new.self_remarks is distinct from old.self_remarks)
       and s.status not in ('draft', 'returned') then
      raise exception 'This month has been sent to your manager, so your core value ratings are locked';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status = 'submitted'
       and (new.manager_rating is distinct from old.manager_rating
            or new.manager_remarks is distinct from old.manager_remarks)
       and now() >= kpi_sub_deadline(s.period_month, 'manager', s.reopen_mgr_until) then
      raise exception '%', kpi_deadline_message(s.period_month, 'manager');
    end if;
    if new.self_rating is distinct from old.self_rating or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
    -- A rating cannot be taken back out of a month that has been scored.
    --
    -- submit_manager_scores refuses to submit with any core value
    -- unrated, which covers the way in. It does not cover the way back:
    -- a scored month is edited by saving rather than submitting, so
    -- clearing a rating there passes no check at all and simply lowers
    -- the core-values figure. Core values are 20 of the 100 and only the
    -- manager rates them, so blanking all five removes a fifth of
    -- somebody's month with nothing on screen or in the log saying it
    -- happened.
    if s.status in ('scored', 'finalized')
       and old.manager_rating is not null
       and new.manager_rating is null then
      raise exception
        'This month is already scored — a core value cannot be left unrated. Change the rating instead.';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_submission_item_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s     kpi_submissions%rowtype;
  me    uuid;
  is_hr boolean;
begin
  if system_write_active() then return new; end if;
  if auth.uid() is null then return new; end if;

  -- A KPI row deleted while a month still points at it: the foreign key
  -- unlinks the month's copy (assignment_item_id set null) and nothing else
  -- about the month changes. Allowed on a finalised month too: the month
  -- keeps its own KRA, target and scores. Refusing it stopped any KPI with a
  -- finalised month from being saved again, and every try left a copy of
  -- its rows behind (0142; Ammu Gopan, 5 Oct).
  if new.assignment_item_id is null and old.assignment_item_id is not null
     and (to_jsonb(new) - 'assignment_item_id') = (to_jsonb(old) - 'assignment_item_id') then
    return new;
  end if;

  select * into s from kpi_submissions where id = new.submission_id;
  me    := current_employee_id();
  is_hr := is_hr_admin() or is_sw_admin();

  if s.status = 'finalized' and not is_hr then
    raise exception 'This month is finalised and cannot be changed';
  end if;
  if is_hr then return new; end if;

  -- Weightage, KRA and the scoring rule are the agreed contract for the
  -- year. The target is the one part that may move month to month.
  if new.weightage is distinct from old.weightage
     or new.scoring_rule is distinct from old.scoring_rule
     or new.rule_params is distinct from old.rule_params
     or new.kra is distinct from old.kra then
    raise exception 'The KRA, weightage and scoring rule are fixed for the year';
  end if;

  if s.employee_id = me then
    if (new.self_achieved is distinct from old.self_achieved
        or new.self_remarks is distinct from old.self_remarks)
       and now() >= kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until) then
      raise exception '%', kpi_deadline_message(s.period_month, 'tm');
    end if;
    if new.manager_achieved is distinct from old.manager_achieved
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager assessment';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status = 'submitted'
       and (new.manager_achieved is distinct from old.manager_achieved
            or new.manager_remarks is distinct from old.manager_remarks)
       and now() >= kpi_sub_deadline(s.period_month, 'manager', s.reopen_mgr_until) then
      raise exception '%', kpi_deadline_message(s.period_month, 'manager');
    end if;
    if new.self_achieved is distinct from old.self_achieved
       or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self assessment';
    end if;
  else
    raise exception 'Not permitted';
  end if;

  new.self_score    := old.self_score;
  new.manager_score := old.manager_score;
  new.final_score   := old.final_score;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.kpi_can_recall(p_submission_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from kpi_submissions s
                 where s.id = p_submission_id and s.employee_id = current_employee_id()
                   and s.status = 'submitted'
                   and coalesce(now() < kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until), true))
     and not kpi_manager_started(p_submission_id)
$function$;

CREATE OR REPLACE FUNCTION public.kpi_recall(p_submission_id uuid)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id for update;
  if not found or s.employee_id <> current_employee_id() then raise exception 'You can recall only your own month'; end if;
  if s.status <> 'submitted' then raise exception 'This month is no longer waiting for your manager'; end if;
  if now() >= kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.return_submission(p_submission_id uuid, p_reason text)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can return this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'Only a submitted month can be returned (current: %)', s.status;
  end if;

  -- Sent back after the team member's last day, it could never come back (0153).
  if now() >= kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until) then
    raise exception 'The last day for team members to submit % was %, so it can no longer be returned.',
      to_char(s.period_month, 'Mon-YY'), kpi_last_day_label(s.period_month, 'tm');
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'returned', returned_at = now(), return_reason = p_reason
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'returned',
                    jsonb_build_object('reason', p_reason));
  return s;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_manager_scores(p_submission_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s        kpi_submissions%rowtype;
  missing  int;
  gap      numeric;
  who      text;
  -- Mirrored in the client as SCORE_CUT_POINTS. If one moves, move both.
  cut_at   constant numeric := 5;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can score this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'This month is not ready for scoring (current: %)', s.status;
  end if;

  -- The manager's last day (0153). A month already scored can still be
  -- revised while it is open (an answered query); a first score cannot.
  if s.status = 'submitted' and now() >= kpi_sub_deadline(s.period_month, 'manager', s.reopen_mgr_until) then
    raise exception '%', kpi_deadline_message(s.period_month, 'manager');
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  -- And the core values, which only the manager rates now.
  --
  -- Nothing checked this before, because the employee rated them and
  -- their own submit was gated on it. When core values moved to the
  -- manager that gate became unsatisfiable and was removed in 0100 --
  -- which left nobody required to fill them at all. An unrated block
  -- scores nothing, and core values are 20 of the 100, so a manager who
  -- simply did not scroll that far would take a fifth of somebody's
  -- month away without either of them seeing it happen.
  select count(*) into missing
  from core_value_ratings r
  where r.submission_id = p_submission_id
    and ((r.manager_rating is null and not exists (select 1 from core_value_part_ratings p where p.rating_id = r.id))
         or exists (select 1 from core_value_part_ratings p where p.rating_id = r.id and p.manager_rating is null));
  if missing > 0 then
    raise exception
      '% core value(s) still need your rating. They are worth 20%% of the score.',
      missing;
  end if;

  -- And a low one needs a reason.
  --
  -- Satisfactory and Poor are the bottom two of the five, and a core
  -- value is a judgement about how somebody conducts themselves rather
  -- than a figure they missed -- the score they can do least about
  -- without being told why. The reason is shown to them, which is the
  -- whole point of collecting it.
  --
  -- Read off rating_scale rather than compared against the words, so
  -- rewording a label does not silently switch the requirement off.
  select count(*) into missing
  from core_value_ratings r
  left join rating_scale rs on rs.label = r.manager_rating
  where r.submission_id = p_submission_id
    and coalesce(r.manager_points, rs.points) <= 40
    and coalesce(btrim(r.manager_remarks), '') = '';
  if missing > 0 then
    raise exception
      '% core value(s) rated Satisfactory or Poor need a reason. % will see it.',
      missing,
      coalesce((select split_part(full_name, ' ', 1) from employees where id = s.employee_id), 'They');
  end if;

  -- How far below their own assessment this lands.
  -- Compared on the rows BOTH of them assessed: job role and ESMS.
  --
  -- It used to be the two totals, which was like for like while the
  -- employee also rated core values. It is not any more -- their total
  -- is job role and ESMS, the manager's is that plus core values -- so
  -- the manager's figure is now almost always the LARGER of the two and
  -- the gap comes out negative. The safeguard that makes a manager
  -- explain a score well below somebody's own assessment had quietly
  -- stopped being able to fire at all.
  gap := case
    when s.self_job_role_score is null or s.mgr_job_role_score is null then null
    else (coalesce(s.self_job_role_score, 0) + coalesce(s.self_esms_score, 0))
       - (coalesce(s.mgr_job_role_score, 0)  + coalesce(s.mgr_esms_score, 0))
  end;

  if gap is not null and gap > cut_at then
    if p_reason is null or btrim(p_reason) = '' then
      select split_part(full_name, ' ', 1) into who
      from employees where id = s.employee_id;
      raise exception
        'Your score is % points below %''s own assessment on the rows you both filled in. Say why before you submit — they will see it.',
        round(gap, 1), coalesce(who, 'their');
    end if;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status            = 'scored',
      manager_scored_at = now(),
      -- Cleared when the gap closes. A manager who revises upward should
      -- not leave last version's explanation attached to a score it no
      -- longer describes.
      score_cut_reason  = case
        when gap is not null and gap > cut_at then btrim(p_reason)
        else nullif(btrim(coalesce(p_reason, '')), '')
      end
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored',
                    jsonb_build_object('gap', gap,
                                       'explained', p_reason is not null));
  return s;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_self_assessment(p_submission_id uuid)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s       kpi_submissions%rowtype;
  missing int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if s.employee_id <> current_employee_id() then
    raise exception 'You can only submit your own assessment';
  end if;
  if s.status not in ('draft','returned') then
    raise exception 'This month has already been submitted (current: %)', s.status;
  end if;

  -- The last day (0153): after it nothing more is entered for the month.
  if now() >= kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until) then
    raise exception '%', kpi_deadline_message(s.period_month, 'tm');
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  -- A KPI that asks the team member to rate their own core values (0214) needs every one rated,
  -- each with a comment. Any other KPI has no core-value gate: those are the manager's.
  if exists (select 1 from kpi_assignments a where a.id = s.assignment_id and a.core_self_rating) then
    select count(*) into missing from core_value_part_ratings
    where submission_id = p_submission_id and is_goal and nullif(btrim(coalesce(goal, '')), '') is null;
    if missing > 0 then
      raise exception '% learning goal(s) still need writing', missing;
    end if;
    select count(*) into missing from core_value_ratings r
    where r.submission_id = p_submission_id
      and ((r.self_rating is null and not exists (select 1 from core_value_part_ratings p where p.rating_id = r.id))
           or exists (select 1 from core_value_part_ratings p where p.rating_id = r.id and p.self_rating is null)
           or nullif(btrim(coalesce(r.self_remarks, '')), '') is null);
    if missing > 0 then
      raise exception '% core value(s) still need your rating and a comment', missing;
    end if;
  end if;

  -- Otherwise no core-value gate. Those moved to the manager, so there is nothing
  -- here for the employee to have missed.
  --
  -- This required every core_value_ratings.self_rating to be filled, and
  -- once the dropdown that filled them was taken off the form the check
  -- could not be satisfied by anybody. Every submission failed with
  -- "5 core value(s) have not been rated", naming a control the person
  -- could not see. The manager's ratings are checked when the MANAGER
  -- submits, which is where that judgement now lives.

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'submitted', self_submitted_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'self_submitted', '{}'::jsonb);
  return s;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_kpi_for(p_ecode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                              'last_day_passed', coalesce(now() >= kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until), false))
                            order by s.period_month)
                              from kpi_submissions s where s.assignment_id = a.id), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_kpi_to_draft(p_assignment_id uuid, p_months date[] DEFAULT NULL::date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and now() >= kpi_sub_deadline(s.period_month, 'tm', s.reopen_tm_until);
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
    update core_value_part_ratings set manager_rating = null where submission_id = r.id;
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
    perform ensure_core_parts(r.id);
    perform set_config('cyrix.system_write', 'on', true);
    perform recompute_submission_totals(r.id);
    perform set_config('cyrix.system_write', 'on', true);
    perform log_audit('kpi_submission', r.id, 'sw_admin_to_draft', jsonb_build_object(
      'was', r.status, 'mgr_total', r.mgr_total_score, 'final_total', r.final_total_score, 'outcome', r.deadline_outcome));
    moved := moved || to_char(r.period_month, 'Mon-YY');
  end loop;
  perform set_config('cyrix.system_write', 'off', true);

  return jsonb_build_object('months', cardinality(moved), 'list', to_jsonb(moved));
end $function$;

CREATE OR REPLACE FUNCTION public.settle_kpi_deadlines()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n      integer := 0;
  r      record;
  from_m date;
begin
  select (value->>'deadlines_from')::date into from_m from app_settings where key = 'tat_policy';
  perform set_config('cyrix.system_write', 'on', true);

  -- 1. Open again: the day was moved later, or the rule switched off.
  for r in
    select id, deadline_outcome, outcome_from_status
    from kpi_submissions
    where deadline_outcome is not null
      and coalesce(now() < case when deadline_outcome = 'not_scored'
            then kpi_sub_deadline(period_month, 'manager', reopen_mgr_until)
            else kpi_sub_deadline(period_month, 'tm', reopen_tm_until) end, true)
  loop
    update kpi_submissions
    set status = r.outcome_from_status, finalized_at = null,
        deadline_outcome = null, outcome_from_status = null
    where id = r.id;
    perform recompute_submission_totals(r.id);
    perform log_audit('kpi_submission', r.id, 'last_day_reopened', jsonb_build_object('was', r.deadline_outcome));
    n := n + 1;
  end loop;

  if from_m is not null then
    -- 2. A month nobody opened is still owed: open it, so it can hold its 0.
    for r in
      select a.employee_id, m::date as month
      from kpi_assignments a
      join employees e on e.id = a.employee_id and e.is_active
      join financial_years f on f.code = a.financial_year
      cross join lateral generate_series(
        greatest(date_trunc('month', f.starts_on)::date, from_m,
                 coalesce(date_trunc('month', a.starts_from)::date, from_m)),
        date_trunc('month', least(f.ends_on::date, now()::date))::date,
        interval '1 month') m
      where a.status = 'active'
        and now() >= kpi_deadline_at(m::date, 'tm')
        and not exists (select 1 from kpi_submissions s
                        where s.employee_id = a.employee_id and s.period_month = m::date)
    loop
      begin
        perform open_submission(r.employee_id, r.month);
      exception when others then
        null;  -- no KPI for that month after all; nothing is owed
      end;
    end loop;
    perform set_config('cyrix.system_write', 'on', true);

    -- 3. Not sent in by the team member's last day: 0.
    for r in
      update kpi_submissions
      set outcome_from_status = status, deadline_outcome = 'not_submitted',
          status = 'finalized', finalized_at = now()
      where status in ('draft', 'returned') and deadline_outcome is null
        and now() >= kpi_sub_deadline(period_month, 'tm', reopen_tm_until)
      returning id
    loop
      perform recompute_submission_totals(r.id);
      perform log_audit('kpi_submission', r.id, 'last_day_missed', '{"side": "tm"}'::jsonb);
      n := n + 1;
    end loop;

    -- 4. Not scored by the manager's last day: the team member's own score.
    for r in
      update kpi_submissions
      set outcome_from_status = status, deadline_outcome = 'not_scored',
          status = 'finalized', finalized_at = now()
      where status = 'submitted' and deadline_outcome is null
        and now() >= kpi_sub_deadline(period_month, 'manager', reopen_mgr_until)
      returning id
    loop
      perform recompute_submission_totals(r.id);
      perform log_audit('kpi_submission', r.id, 'last_day_missed', '{"side": "manager"}'::jsonb);
      n := n + 1;
    end loop;
  end if;

  perform set_config('cyrix.system_write', 'off', true);
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_submission_header()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if system_write_active() then
    return new;
  end if;

  -- No end user means a direct database connection: a migration, an admin
  -- script, or the service role. Those are trusted and bypass RLS anyway.
  -- An anonymous PostgREST caller never reaches here — every policy on this
  -- table is `to authenticated`, and anon holds no UPDATE grant.
  if auth.uid() is null then
    return new;
  end if;

  if is_hr_admin() then return new; end if;

  -- Set by an approved request to open the month (0273), never by hand.
  if new.reopen_tm_until is distinct from old.reopen_tm_until
     or new.reopen_mgr_until is distinct from old.reopen_mgr_until then
    raise exception 'A month is opened again by a request that HR approves';
  end if;

  -- Set by the last day and undone by it (0153), never by hand.
  if new.deadline_outcome is distinct from old.deadline_outcome
     or new.outcome_from_status is distinct from old.outcome_from_status then
    raise exception 'A missed last day is set by the KPI timing, not by hand';
  end if;

  if new.status is distinct from old.status then
    raise exception 'Status changes must go through the submit / score / finalise actions';
  end if;
  if new.self_total_score    is distinct from old.self_total_score
     or new.mgr_total_score   is distinct from old.mgr_total_score
     or new.final_total_score is distinct from old.final_total_score then
    raise exception 'Scores are calculated and cannot be set directly';
  end if;

  -- New in 0045. It belongs to the scoring action, not to whoever holds
  -- an UPDATE grant on the row.
  if new.score_cut_reason is distinct from old.score_cut_reason then
    raise exception 'The reason for a reduced score is set when the score is submitted';
  end if;

  if old.employee_id = current_employee_id() then
    if new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager remarks';
    end if;
  elsif manages_employee(old.employee_id) then
    if new.employee_remarks is distinct from old.employee_remarks then
      raise exception 'You cannot edit the team member''s remarks';
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.review_record_deletion(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS record_deletion_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record_deletion_requests%rowtype;
  me uuid := current_employee_id();
begin
  select * into r from record_deletion_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;

  if r.status = 'pending_manager' then
    if not (manages_employee(r.employee_id) or is_hr_admin()) then
      raise exception 'Only the reporting manager can action this stage';
    end if;
    update record_deletion_requests
    set status = case when p_approve then 'pending_hr' else 'rejected' end,
        manager_id = me, manager_decided_at = now(), manager_note = p_note
    where id = p_request_id returning * into r;

  elsif r.status = 'pending_hr' then
    if not is_hr_admin() then
      raise exception 'Only HR can action the final stage';
    end if;
    update record_deletion_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        hr_id = me, hr_decided_at = now(), hr_note = p_note
    where id = p_request_id returning * into r;

    if p_approve and r.kind = 'reopen' then
      perform kpi_reopen_month(r.submission_id, r.closed_as);
    elsif p_approve then
      -- Log the numbers before they go, so the audit trail survives the row.
      perform log_audit('kpi_submission', r.submission_id, 'deleted_after_approval',
        (select jsonb_build_object(
           'period', s.period_month, 'employee', s.employee_id,
           'self_total', s.self_total_score, 'final_total', s.final_total_score,
           'reason', r.reason)
         from kpi_submissions s where s.id = r.submission_id));
      delete from kpi_submissions where id = r.submission_id;
    end if;

  else
    raise exception 'That request has already been decided';
  end if;

  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.pending_admin_work(p_desk text)
 RETURNS TABLE(kind text, source_id uuid, who text, headline text, detail text, waiting_since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with allowed as (
    select
      -- No end user is a direct connection: a migration, an admin script,
      -- or the service role the round-up mail runs as.
      auth.uid() is null
      or (p_desk = 'hr' and is_hr_admin())
      or (p_desk = 'sw' and is_sw_admin())
      or (p_desk = 'it' and is_it_admin())
      as ok
  ),
  named as (
    select e.id, e.full_name || ' (' || e.ecode || ')' as label from employees e
  )
  select 'support',
         t.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has asked a question',
         left(coalesce(t.employee_note, ''), 300),
         coalesce(t.raised_at, t.created_at)
  from support_tickets t
  left join named n on n.id = t.employee_id
  where (select ok from allowed)
    and t.status = 'open'
    and t.desk = case when p_desk = 'sw' then 'software' when p_desk = 'it' then 'it' else 'hr' end

  union all
  -- Everything below is HR's. The software desk staffs one queue.
  select 'leaver',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has been flagged as having left',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from tm_removal_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending'

  union all
  select 'record',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || case when r.kind = 'reopen'
           then case when r.closed_as = 'not_scored' then ' · open a month the manager did not score in time'
                     else ' · open a month not sent in on time' end
           else ' wants a month removed' end,
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from record_deletion_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending_hr'

  union all
  select 'revision',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants their KPI reopened',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from kpi_revision_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending_hr'

  order by 6
$function$;
