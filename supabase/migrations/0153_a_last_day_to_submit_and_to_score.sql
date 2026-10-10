-- =====================================================================
-- Cyrix KPI  ·  0153  ·  A last day to submit, and a last day to score
--
-- HR, 10 Oct: the cool-off allowances measured lateness for a manager
-- ranking that is no longer there. The two numbers become last days:
--
--   team member   tm_grace_days        12 = enter the month until the end
--                                         of the 12th of the next month
--   manager       manager_grace_days   15 = score it until the end of the 15th
--
-- After the team member's last day nothing more can be entered or
-- submitted; a month not sent in is scored 0. After the manager's, a
-- month still waiting for a first score takes the team member's own job
-- role (and ESMS) score with full marks for core values, which only the
-- manager rates (the user's choice).
--
-- From Sep-26 on (tat_policy.deadlines_from). Months before it are left
-- as they are.
--
-- SW Admin can move either day later and the month opens again (the
-- user: "sw admin can change and unlock by changing dates"). So the
-- outcome is not a one-way write: the month remembers the status it had
-- (outcome_from_status) and settle_kpi_deadlines() puts it back the
-- moment its last day is in the future again. Saving the timing settles
-- straight away, so the change is felt at once.
--
-- No scheduler, as with the month close: months settle when a screen
-- that lists them is read, through settle_due_submissions().
-- =====================================================================

alter table kpi_submissions
  add column if not exists deadline_outcome text
    check (deadline_outcome in ('not_submitted', 'not_scored')),
  add column if not exists outcome_from_status text;

comment on column kpi_submissions.deadline_outcome is
  'Set when a last day passed (0153): not_submitted = scored 0; not_scored = the team member''s own score with full core values. Undone if the day moves later.';

update app_settings
set value = value || '{"deadlines_from": "2026-09-01"}'::jsonb
where key = 'tat_policy';


-- ---------------------------------------------------------------------
-- When the last day ends: the end of day N of the following month, IST.
-- Null before deadlines_from, or with no policy at all.
-- ---------------------------------------------------------------------
create or replace function kpi_deadline_at(p_period_month date, p_side text)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when p.value->>'deadlines_from' is null
      or date_trunc('month', p_period_month)::date < (p.value->>'deadlines_from')::date then null
    else (
      date_trunc('month', p_period_month)::date + interval '1 month'
      + make_interval(days => greatest(1, least(28,
          (p.value->>(case when p_side = 'manager' then 'manager_grace_days' else 'tm_grace_days' end))::int)))
    ) at time zone 'Asia/Kolkata'
  end
  from app_settings p where p.key = 'tat_policy'
$$;

grant execute on function kpi_deadline_at(date, text) to authenticated;

-- "12 Oct": the day itself, not the instant after it.
create or replace function kpi_last_day_label(p_period_month date, p_side text)
returns text
language sql stable security definer set search_path = public as $$
  select to_char((kpi_deadline_at(p_period_month, p_side) at time zone 'Asia/Kolkata') - interval '1 day', 'FMDD Mon')
$$;

create or replace function kpi_deadline_message(p_period_month date, p_side text)
returns text
language sql stable security definer set search_path = public as $$
  select case when p_side = 'manager' then
    format('The last day to score %s was %s. The team member''s own job role score counts, with full marks for core values.',
           to_char(p_period_month, 'Mon-YY'), kpi_last_day_label(p_period_month, 'manager'))
  else
    format('The last day to submit your %s KPI was %s. The month is scored 0.',
           to_char(p_period_month, 'Mon-YY'), kpi_last_day_label(p_period_month, 'tm'))
  end
$$;

grant execute on function kpi_last_day_label(date, text) to authenticated;
grant execute on function kpi_deadline_message(date, text) to authenticated;


-- ---------------------------------------------------------------------
-- Settling the last days.
-- ---------------------------------------------------------------------
create or replace function settle_kpi_deadlines()
returns integer
language plpgsql volatile security definer set search_path = public as $$
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
      and coalesce(now() < kpi_deadline_at(period_month,
            case when deadline_outcome = 'not_scored' then 'manager' else 'tm' end), true)
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
        and now() >= kpi_deadline_at(period_month, 'tm')
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
        and now() >= kpi_deadline_at(period_month, 'manager')
      returning id
    loop
      perform recompute_submission_totals(r.id);
      perform log_audit('kpi_submission', r.id, 'last_day_missed', '{"side": "manager"}'::jsonb);
      n := n + 1;
    end loop;
  end if;

  perform set_config('cyrix.system_write', 'off', true);
  return n;
end $$;

grant execute on function settle_kpi_deadlines() to authenticated;


-- ---------------------------------------------------------------------
-- The timing settings: two last days, 1 to 28 like the closing day; the
-- start month for deadlines kept; settled at once.
-- ---------------------------------------------------------------------
create or replace function set_tat_policy(
  p_tm_grace      int,
  p_manager_grace int,
  p_starts_from   date default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v    jsonb;
  prev jsonb;
begin
  if not (is_sw_admin() or is_hr_admin()) then
    raise exception 'Only SW Admin can change the KPI timing';
  end if;

  if p_tm_grace is null or p_tm_grace < 1 or p_tm_grace > 28
     or p_manager_grace is null or p_manager_grace < 1 or p_manager_grace > 28 then
    raise exception 'A last day must be between the 1st and the 28th';
  end if;

  if p_manager_grace < p_tm_grace then
    raise exception
      'The manager''s last day (%) cannot come before the team member''s (%)',
      p_manager_grace, p_tm_grace;
  end if;

  select value into prev from app_settings where key = 'tat_policy';

  v := coalesce(prev, '{}'::jsonb) || jsonb_build_object(
    'tm_grace_days', p_tm_grace,
    'manager_grace_days', p_manager_grace,
    'starts_from', case when p_starts_from is null then null
                       else to_char(date_trunc('month', p_starts_from), 'YYYY-MM-DD') end
  );

  insert into app_settings (key, value, description, updated_at)
  values ('tat_policy', v, 'Last day of the following month to submit (tm_grace_days) and to score (manager_grace_days); deadlines apply from deadlines_from; starts_from is the first month turnaround is measured.', now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform settle_kpi_deadlines();
  return v;
end $$;

grant execute on function set_tat_policy(int, int, date) to authenticated;


-- ---------------------------------------------------------------------
-- The checks, in the functions that enter, submit, score and return.
-- ---------------------------------------------------------------------
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
  if now() >= kpi_deadline_at(s.period_month, 'tm') then
    raise exception '%', kpi_deadline_message(s.period_month, 'tm');
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  -- No core-value gate. Those moved to the manager, so there is nothing
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
end $function$
;

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
  if s.status = 'submitted' and now() >= kpi_deadline_at(s.period_month, 'manager') then
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
  from core_value_ratings
  where submission_id = p_submission_id and manager_rating is null;
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
  join rating_scale rs on rs.label = r.manager_rating
  where r.submission_id = p_submission_id
    and rs.points <= 40
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
end $function$
;

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
  if now() >= kpi_deadline_at(s.period_month, 'tm') then
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
end $function$
;

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
       and now() >= kpi_deadline_at(s.period_month, 'tm') then
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
       and now() >= kpi_deadline_at(s.period_month, 'manager') then
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
end $function$
;

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

  select * into s from kpi_submissions where id = new.submission_id;
  if is_hr_admin() then return new; end if;
  me := current_employee_id();

  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager rating';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status = 'submitted'
       and (new.manager_rating is distinct from old.manager_rating
            or new.manager_remarks is distinct from old.manager_remarks)
       and now() >= kpi_deadline_at(s.period_month, 'manager') then
      raise exception '%', kpi_deadline_message(s.period_month, 'manager');
    end if;
    if new.self_rating is distinct from old.self_rating then
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
end $function$
;

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
end $function$
;

CREATE OR REPLACE FUNCTION public.recompute_submission_totals(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  prev_write text;
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
  prev_write := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);

  select value into blend from app_settings where key = 'score_blend';
  -- The fallback is the policy, not the old policy.
  --
  -- These defaulted to 0.5/0.5, which was right until 0095 made the
  -- manager's figure the score. The stored row says 0/1 and is what
  -- actually runs, so nothing is wrong today -- but a fallback is a
  -- promise about what happens when the row is missing, and this one
  -- promised to go back to averaging. Deleting a settings row would have
  -- silently rescored the company back to a rule management withdrew.
  self_w := coalesce((blend->>'self_weight')::numeric,    0);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 1);

  update kpi_submission_items i
  set
    self_score    = calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                   i.self_achieved, i.rule_params),
    manager_score = case
                      when i.manager_achieved is null then null
                      else calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                          i.manager_achieved, i.rule_params)
                    end,
    final_score   = case
                      when i.manager_achieved is null then null
                      else round(
                        self_w * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.self_achieved, i.rule_params)
                      + mgr_w  * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.manager_achieved, i.rule_params), 4)
                    end
  where i.submission_id = p_submission_id;

  update kpi_submissions s
  set
    self_job_role_score  = t.self_job,
    self_esms_score      = t.self_esms,
    self_core_score      = t.self_core,
    self_total_score     = coalesce(t.self_job, 0) + coalesce(t.self_esms, 0)
                         + coalesce(t.self_core, 0),
    mgr_job_role_score   = t.mgr_job,
    mgr_esms_score       = t.mgr_esms,
    mgr_core_score       = t.mgr_core,
    mgr_total_score      = case when t.mgr_scored_rows = 0 then null
                           else coalesce(t.mgr_job, 0) + coalesce(t.mgr_esms, 0)
                              + coalesce(t.mgr_core, 0) end,
    final_job_role_score = t.fin_job,
    final_esms_score     = t.fin_esms,
    final_core_score     = t.fin_core,
    final_total_score    = case when t.fin_scored_rows = 0 then null
                           else coalesce(t.fin_job, 0) + coalesce(t.fin_esms, 0)
                              + coalesce(t.fin_core, 0) end
  from (
    select
      sum(self_score)    filter (where section = 'job_role')    as self_job,
      sum(self_score)    filter (where section = 'esms')        as self_esms,
      sum(self_score)    filter (where section = 'core_values') as self_core,
      sum(manager_score) filter (where section = 'job_role')    as mgr_job,
      sum(manager_score) filter (where section = 'esms')        as mgr_esms,
      sum(manager_score) filter (where section = 'core_values') as mgr_core,
      sum(final_score)   filter (where section = 'job_role')    as fin_job,
      sum(final_score)   filter (where section = 'esms')        as fin_esms,
      sum(final_score)   filter (where section = 'core_values') as fin_core,
      count(manager_score) as mgr_scored_rows,
      count(final_score)   as fin_scored_rows
    from kpi_submission_items
    where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id;

  -- A missed last day (0153). Nothing submitted: the month is 0.
  -- Not scored by the manager: the team member's own job role and ESMS,
  -- with full marks for core values, which only the manager rates.
  update kpi_submissions s
  set final_job_role_score = case when s.deadline_outcome = 'not_submitted' then 0 else coalesce(s.self_job_role_score, 0) end,
      final_esms_score     = case when not t.has_esms then null
                                  when s.deadline_outcome = 'not_submitted' then 0
                                  else coalesce(s.self_esms_score, 0) end,
      final_core_score     = case when s.deadline_outcome = 'not_submitted' then 0 else t.core_full end,
      final_total_score    = case when s.deadline_outcome = 'not_submitted' then 0
                                  else coalesce(s.self_job_role_score, 0) + coalesce(s.self_esms_score, 0) + t.core_full end
  from (
    select coalesce(sum(weightage) filter (where section = 'core_values'), 0) as core_full,
           bool_or(section = 'esms') as has_esms
    from kpi_submission_items where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id and s.deadline_outcome is not null;

  perform set_config('cyrix.system_write', prev_write, true);
end $function$
;

CREATE OR REPLACE FUNCTION public.settle_due_submissions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  -- Last days first (0153): a month that missed one is settled by it.
  perform settle_kpi_deadlines();
  perform set_config('cyrix.system_write', 'on', true);

  with due as (
    update kpi_submissions s
    set status = 'finalized', finalized_at = now()
    where s.status = 'scored'
      and s.manager_scored_at is not null
      and month_close_at(s.period_month) is not null
      and now() > greatest(
            month_close_at(s.period_month),
            s.manager_scored_at + interval '1 day')
      and not exists (
        select 1 from kpi_score_queries q
        where q.submission_id = s.id and q.status = 'open')
    returning s.id
  )
  select count(*) into n from due;

  perform set_config('cyrix.system_write', 'off', true);
  return n;
end $function$
;
