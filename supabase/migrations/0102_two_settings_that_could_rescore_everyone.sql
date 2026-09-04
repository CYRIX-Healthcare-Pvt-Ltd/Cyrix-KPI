-- =====================================================================
-- Cyrix KPI  ·  0102  ·  Two settings that could rescore the company
--
-- From a sweep of every guard and default in the database against the
-- rules as 0095-0101 left them. 164 exception guards across 56 functions
-- and 16 check constraints were read; almost all are authorisation and
-- status checks that scoring never touched, and no constraint caps a
-- score at its weightage or at 100, so the uncapped rule cannot trip
-- one.
--
-- Two things were wrong, and neither is failing today. Both are worse
-- than a bug for that reason: they are correct-looking code waiting for
-- somebody to change a settings row.
--
-- 1. recompute_submission_totals fell back to a 50/50 blend.
--
--    The stored score_blend row says 0/1 and is what runs, so every
--    score today is the manager's. But the fallback is a promise about
--    what happens when the row is absent, and this one promised to go
--    back to averaging -- the rule management withdrew. Deleting one
--    settings row would have silently rescored 86 months.
--
-- 2. core_values_mirror_self would take 20 points off everybody.
--
--    It copies the employee's self rating into the manager's figure, for
--    a period when managers were not rating core values. It is now
--    exactly backwards: the employee does not rate them and the manager
--    does. Switching it on would copy a rating that no longer exists,
--    leave the manager average null, and remove the whole 20-point block
--    from every person -- silently, because a null average reads as an
--    unrated block rather than as an error.
--
--    It is false, so nothing is broken. A setting whose only remaining
--    effect is to break scoring for the entire company should not be one
--    keystroke away, so the branch goes rather than the value being
--    trusted to stay false. The row is deleted too, so nothing is left
--    offering a switch that does nothing.
--
-- Both are the live definitions with the smallest possible edit, taken
-- from pg_get_functiondef and verified by reversing the edit and diffing
-- back to the original.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.recompute_submission_totals(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  blend  jsonb;
  self_w numeric;
  mgr_w  numeric;
begin
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

  perform set_config('cyrix.system_write', 'off', true);
end $function$;

CREATE OR REPLACE FUNCTION public.sync_core_value_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  sid      uuid := coalesce(new.submission_id, old.submission_id);
  self_avg numeric;
  mgr_avg  numeric;
  -- the mirror variable is gone; see below.
begin
  perform set_config('cyrix.system_write', 'on', true);

  select avg(rs.points) into self_avg
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
  select avg(rs.points) into mgr_avg
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


-- The setting the branch used to read. Nothing consults it now, and a
-- switch that does nothing is one somebody will eventually flip to find
-- out what it does.
delete from app_settings where key = 'core_values_mirror_self';

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Proves the fallback rather than the stored value: the row is removed
-- inside the probe, totals are recomputed, and the score must still be
-- the manager's. That is the case that used to revert to averaging.
-- ---------------------------------------------------------------------
do $test$
declare
  sid  uuid;
  mgr  numeric;
  fin  numeric;
begin
  select id into sid from kpi_submissions
  where mgr_total_score is not null and status in ('scored', 'finalized')
    and self_total_score is distinct from mgr_total_score
  limit 1;

  if sid is null then
    raise notice '0102 self-test skipped (no month where self and manager differ)';
    return;
  end if;

  -- With no score_blend row at all, the defaults in the function decide.
  delete from app_settings where key = 'score_blend';
  perform recompute_submission_totals(sid);

  select mgr_total_score, final_total_score into mgr, fin
  from kpi_submissions where id = sid;

  if fin is distinct from mgr then
    raise exception
      'with no score_blend row the final came to % but the manager gave %', fin, mgr;
  end if;

  -- And the mirror is genuinely gone from the rollup.
  if exists (
    select 1 from pg_proc where proname = 'sync_core_value_rollup'
      and prosrc like '%mgr_avg := self_avg%'
  ) then
    raise exception 'the core-value mirror is still in the rollup';
  end if;

  raise notice '0102 self-test passed (fallback is the manager; mirror removed)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
