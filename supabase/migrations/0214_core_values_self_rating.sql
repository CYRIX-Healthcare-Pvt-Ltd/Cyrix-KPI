-- Team members rate their own core values, on a KPI that asks for it (the user, 16 Oct).
--
-- A checkbox on the KPI, beside ESMS: "Team member rates core values". Ticked, the team member
-- rates each core value with a required comment when they fill in the month; the manager still
-- rates them, optionally with a comment, and the manager's rating is what counts. A month the
-- manager does not score by their last day takes the team member's own core value rating rather
-- than full marks. Each core value can carry its own weight on the KPI; none set, all equal.
-- Months already filed keep the KPI they were filed with.

alter table kpi_assignments add column if not exists core_self_rating boolean not null default false;
alter table kpi_assignments add column if not exists core_value_weights jsonb;
alter table core_value_ratings add column if not exists self_remarks text;

-- Set by whoever may edit the KPI itself; checked to add up to the core values share.
create or replace function public.set_core_value_options(p_assignment_id uuid, p_self boolean, p_weights jsonb)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare a kpi_assignments%rowtype; total numeric;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'KPI not found'; end if;
  if not (a.employee_id = current_employee_id() or manages_employee(a.employee_id) or is_hr_admin() or is_sw_admin()) then
    raise exception 'Not permitted';
  end if;
  if p_weights is not null then
    select sum((v)::numeric) into total from jsonb_each_text(p_weights) as e(k, v);
    if total is null or abs(total - a.core_values_weight) > 0.01 then
      raise exception 'Core value weights must add up to %', a.core_values_weight || '%';
    end if;
  end if;
  update kpi_assignments set core_self_rating = coalesce(p_self, false), core_value_weights = p_weights where id = p_assignment_id;
  perform log_audit('kpi_assignment', p_assignment_id, 'core_value_options',
    jsonb_build_object('self', coalesce(p_self, false), 'weights', p_weights));
end $f$;
revoke all on function public.set_core_value_options(uuid, boolean, jsonb) from public, anon;
grant execute on function public.set_core_value_options(uuid, boolean, jsonb) to authenticated;

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

  -- A KPI that asks the team member to rate their own core values (0214) needs every one rated,
  -- each with a comment. Any other KPI has no core-value gate: those are the manager's.
  if exists (select 1 from kpi_assignments a where a.id = s.assignment_id and a.core_self_rating) then
    select count(*) into missing from core_value_ratings
    where submission_id = p_submission_id
      and (self_rating is null or nullif(btrim(coalesce(self_remarks, '')), '') is null);
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
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_core_value_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  sid      uuid := coalesce(new.submission_id, old.submission_id);
  self_avg numeric;
  mgr_avg  numeric;
  -- Each core value's weight on this KPI (0214); none set means all equal, as before.
  w        jsonb;
  -- the mirror variable is gone; see below.
begin
  perform set_config('cyrix.system_write', 'on', true);

  select a.core_value_weights into w
  from kpi_submissions s join kpi_assignments a on a.id = s.assignment_id
  where s.id = sid;

  -- A weighted average on the same 0-100 points scale, so the row still reads as it did.
  select sum(rs.points * coalesce((w->>r.core_value_id::text)::numeric, 1))
         / nullif(sum(coalesce((w->>r.core_value_id::text)::numeric, 1)), 0) into self_avg
  from core_value_ratings r
  join rating_scale rs on rs.label = r.self_rating
  where r.submission_id = sid;

  /*
    The manager's own ratings, always.

    There used to be a core_values_mirror_self setting that copied the
    employee's self rating into the manager's figure, for a period when
    managers were not rating core values at all. It is now exactly
    backwards: the employee does not rate them and the manager does, so
    switching it on would copy a rating that no longer exists, leave
    mgr_avg null, and take the whole 20-point block off every single
    person -- silently, because a null average reads as an unrated block
    rather than as an error.

    It was false, so nothing was broken. A setting whose only remaining
    effect is to break scoring for the entire company should not be one
    keystroke away, so the branch goes rather than the value being
    trusted to stay false.
  */
  select sum(rs.points * coalesce((w->>r.core_value_id::text)::numeric, 1))
         / nullif(sum(coalesce((w->>r.core_value_id::text)::numeric, 1)), 0) into mgr_avg
  from core_value_ratings r
  join rating_scale rs on rs.label = r.manager_rating
  where r.submission_id = sid;

  update kpi_submission_items
  set self_achieved    = self_avg,
      manager_achieved = mgr_avg
  where submission_id = sid
    and section = 'core_values';

  perform set_config('cyrix.system_write', 'off', true);
  return null;
end $function$;

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
      -- A KPI where the team member rates their own core values takes their rating (0214).
      final_core_score     = case when s.deadline_outcome = 'not_submitted' then 0
                                  when t.core_self then coalesce(s.self_core_score, 0) else t.core_full end,
      final_total_score    = case when s.deadline_outcome = 'not_submitted' then 0
                                  else coalesce(s.self_job_role_score, 0) + coalesce(s.self_esms_score, 0)
                                     + case when t.core_self then coalesce(s.self_core_score, 0) else t.core_full end end
  from (
    select coalesce(sum(weightage) filter (where section = 'core_values'), 0) as core_full,
           bool_or(section = 'esms') as has_esms,
           coalesce((select a.core_self_rating from kpi_submissions x join kpi_assignments a on a.id = x.assignment_id
                     where x.id = p_submission_id), false) as core_self
    from kpi_submission_items where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id and s.deadline_outcome is not null;

  perform set_config('cyrix.system_write', prev_write, true);
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
       and now() >= kpi_deadline_at(s.period_month, 'manager') then
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
