-- =====================================================================
-- Cyrix KPI  ·  0010  ·  Let the engine write its own calculated scores
--
-- THE BUG
-- -------
-- 0006 added guard triggers so a client cannot PATCH a score directly.
-- They cannot distinguish the system's own writes from a client's, so
-- they also blocked the scoring engine:
--
--   1. guard_submission_header() RAISED
--      "Scores are calculated and cannot be set directly" whenever
--      recompute_submission_totals() wrote the roll-ups. This is what
--      made "Start <month>" fail outright — open_submission() inserts
--      the rows, the AFTER trigger recomputes, and the recompute's
--      UPDATE tripped the guard.
--
--   2. guard_submission_item_columns() SILENTLY reverted
--      new.self_score / manager_score / final_score to their old values.
--      Quieter and worse: every per-row score would have stayed null
--      forever, with no error to explain why.
--
--   3. sync_core_value_rollup() writes manager_achieved on the core
--      values row. For a TM saving their own rating the guard read that
--      as the TM editing the manager's assessment and raised.
--
-- THE FIX
-- -------
-- The engine announces itself with a transaction-local GUC, and the
-- guards stand down for it. is_local = true on set_config means it dies
-- with the transaction, so it cannot leak into a later statement on a
-- pooled connection, and an exception unwinds it automatically.
--
-- Client writes are unaffected: a TM still cannot touch manager_achieved
-- or post a score of their own.
-- =====================================================================

create or replace function system_write_active()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('cyrix.system_write', true), 'off') = 'on'
$$;

comment on function system_write_active() is
  'True while the scoring engine is writing calculated values. The column '
  'guards defer to it so they block clients without blocking the system.';


-- ---------------------------------------------------------------------
-- Recompute, now flagged as a system write.
-- ---------------------------------------------------------------------
create or replace function recompute_submission_totals(p_submission_id uuid)
returns void
language plpgsql
as $$
declare
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
  perform set_config('cyrix.system_write', 'on', true);

  select value into blend from app_settings where key = 'score_blend';
  self_w := coalesce((blend->>'self_weight')::numeric,    0.5);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 0.5);

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
    self_core_score      = t.self_core,
    self_total_score     = coalesce(t.self_job, 0) + coalesce(t.self_core, 0),
    mgr_job_role_score   = t.mgr_job,
    mgr_core_score       = t.mgr_core,
    mgr_total_score      = case when t.mgr_scored_rows = 0 then null
                           else coalesce(t.mgr_job, 0) + coalesce(t.mgr_core, 0) end,
    final_job_role_score = t.fin_job,
    final_core_score     = t.fin_core,
    final_total_score    = case when t.fin_scored_rows = 0 then null
                           else coalesce(t.fin_job, 0) + coalesce(t.fin_core, 0) end
  from (
    select
      sum(self_score)    filter (where section = 'job_role')    as self_job,
      sum(self_score)    filter (where section = 'core_values') as self_core,
      sum(manager_score) filter (where section = 'job_role')    as mgr_job,
      sum(manager_score) filter (where section = 'core_values') as mgr_core,
      sum(final_score)   filter (where section = 'job_role')    as fin_job,
      sum(final_score)   filter (where section = 'core_values') as fin_core,
      count(manager_score) as mgr_scored_rows,
      count(final_score)   as fin_scored_rows
    from kpi_submission_items
    where submission_id = p_submission_id
  ) t
  where s.id = p_submission_id;

  perform set_config('cyrix.system_write', 'off', true);
end $$;


-- ---------------------------------------------------------------------
-- Core value roll-up, likewise.
-- ---------------------------------------------------------------------
create or replace function sync_core_value_rollup()
returns trigger language plpgsql as $$
declare
  sid      uuid := coalesce(new.submission_id, old.submission_id);
  self_avg numeric;
  mgr_avg  numeric;
  mirror   boolean;
begin
  perform set_config('cyrix.system_write', 'on', true);

  select coalesce(value::text::boolean, false) into mirror
  from app_settings where key = 'core_values_mirror_self';

  select avg(rs.points) into self_avg
  from core_value_ratings r
  join rating_scale rs on rs.label = r.self_rating
  where r.submission_id = sid;

  if coalesce(mirror, false) then
    mgr_avg := self_avg;
  else
    select avg(rs.points) into mgr_avg
    from core_value_ratings r
    join rating_scale rs on rs.label = r.manager_rating
    where r.submission_id = sid;
  end if;

  update kpi_submission_items
  set self_achieved    = self_avg,
      manager_achieved = mgr_avg
  where submission_id = sid
    and section = 'core_values';

  perform set_config('cyrix.system_write', 'off', true);
  return null;
end $$;


-- ---------------------------------------------------------------------
-- Guards: stand down for system writes, unchanged for clients.
-- ---------------------------------------------------------------------
create or replace function guard_submission_item_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s     kpi_submissions%rowtype;
  me    uuid;
  is_hr boolean;
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
  me    := current_employee_id();
  is_hr := is_hr_admin();

  if s.status = 'finalized' and not is_hr then
    raise exception 'This month is finalised and cannot be changed';
  end if;

  if is_hr then
    return new;
  end if;

  if s.employee_id = me then
    if new.manager_achieved is distinct from old.manager_achieved
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager assessment';
    end if;
    if new.weightage is distinct from old.weightage
       or new.target_value is distinct from old.target_value
       or new.scoring_rule is distinct from old.scoring_rule
       or new.rule_params is distinct from old.rule_params
       or new.kra is distinct from old.kra then
      raise exception 'The KPI definition is fixed for the month and cannot be edited here';
    end if;

  elsif manages_employee(s.employee_id) then
    if new.self_achieved is distinct from old.self_achieved
       or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self assessment';
    end if;
    if new.weightage is distinct from old.weightage
       or new.target_value is distinct from old.target_value
       or new.scoring_rule is distinct from old.scoring_rule
       or new.rule_params is distinct from old.rule_params
       or new.kra is distinct from old.kra then
      raise exception 'The KPI definition is fixed for the month and cannot be edited here';
    end if;
  else
    raise exception 'Not permitted';
  end if;

  -- Scores are derived. A client supplying them is ignored rather than
  -- rejected, since the value they sent is simply irrelevant.
  new.self_score    := old.self_score;
  new.manager_score := old.manager_score;
  new.final_score   := old.final_score;

  return new;
end $$;


create or replace function guard_core_rating_columns()
returns trigger language plpgsql security definer set search_path = public as $$
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
    if new.self_rating is distinct from old.self_rating then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $$;


create or replace function guard_submission_header()
returns trigger language plpgsql security definer set search_path = public as $$
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

  if new.status is distinct from old.status then
    raise exception 'Status changes must go through the submit / score / finalise actions';
  end if;
  if new.self_total_score    is distinct from old.self_total_score
     or new.mgr_total_score   is distinct from old.mgr_total_score
     or new.final_total_score is distinct from old.final_total_score then
    raise exception 'Scores are calculated and cannot be set directly';
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
end $$;


-- ---------------------------------------------------------------------
-- The workflow RPCs update status directly, which the header guard also
-- rejects for non-HR callers. They already check permissions themselves,
-- so let them announce their writes the same way.
-- ---------------------------------------------------------------------
create or replace function submit_self_assessment(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
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

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id and section = 'job_role' and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  select count(*) into missing
  from core_value_ratings where submission_id = p_submission_id and self_rating is null;
  if missing > 0 then
    raise exception '% core value(s) have not been rated', missing;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'submitted', self_submitted_at = now(), return_reason = null
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'self_submitted', '{}'::jsonb);
  return s;
end $$;


create or replace function return_submission(p_submission_id uuid, p_reason text)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
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

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'returned', returned_at = now(), return_reason = p_reason
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'returned',
                    jsonb_build_object('reason', p_reason));
  return s;
end $$;


create or replace function submit_manager_scores(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare
  s       kpi_submissions%rowtype;
  missing int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can score this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'This month is not ready for scoring (current: %)', s.status;
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id and section = 'job_role' and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'scored', manager_scored_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored',
                    jsonb_build_object('total', s.final_total_score));
  return s;
end $$;


create or replace function finalize_submission(p_submission_id uuid)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can finalise this';
  end if;
  if s.status <> 'scored' then
    raise exception 'Only a scored month can be finalised (current: %)', s.status;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'finalized', finalized_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'finalized',
                    jsonb_build_object('total', s.final_total_score));
  return s;
end $$;


-- ---------------------------------------------------------------------
-- Regression test: drive a whole month through the engine and assert the
-- scores actually land. This is the check that was missing — the parts
-- were each tested, the combination was not.
-- ---------------------------------------------------------------------
do $$
declare
  sid   uuid := gen_random_uuid();
  eid   uuid;
  aid   uuid;
  got   numeric;
begin
  select id into eid from employees limit 1;
  if eid is null then
    raise notice 'No employees yet — skipping the end-to-end scoring test.';
    return;
  end if;

  insert into kpi_assignments (employee_id, financial_year, status)
  values (eid, '2027-28', 'draft') returning id into aid;

  insert into kpi_submissions (id, assignment_id, employee_id, financial_year,
                               period_month, status)
  values (sid, aid, eid, '2027-28', '2027-04-01', 'draft');

  insert into kpi_submission_items
    (submission_id, section, kra, weightage, target_value, scoring_rule, sort_order)
  values
    (sid, 'job_role',    'Test A', 25, 100, 'higher_capped', 1),
    (sid, 'job_role',    'Test B', 20,  35, 'lower_penalty', 2),
    (sid, 'core_values', 'Test C', 20, 100, 'rating_scale',  3);

  update kpi_submission_items set self_achieved = 100
    where submission_id = sid and kra = 'Test A';
  update kpi_submission_items set self_achieved = 40
    where submission_id = sid and kra = 'Test B';

  select self_score into got from kpi_submission_items
   where submission_id = sid and kra = 'Test A';
  if got is distinct from 25 then
    raise exception 'Per-row score did not persist: expected 25, got %', got;
  end if;

  select self_score into got from kpi_submission_items
   where submission_id = sid and kra = 'Test B';
  if got is distinct from 17.5 then
    raise exception 'lower_penalty did not persist: expected 17.5, got %', got;
  end if;

  select self_total_score into got from kpi_submissions where id = sid;
  if got is distinct from 42.5 then
    raise exception 'Header roll-up wrong: expected 42.5, got %', got;
  end if;

  delete from kpi_submissions where id = sid;
  delete from kpi_assignments where id = aid;

  raise notice 'End-to-end scoring test passed: scores compute and persist.';
end $$;
