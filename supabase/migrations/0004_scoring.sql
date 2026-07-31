-- =====================================================================
-- Cyrix KPI  ·  0004  ·  The scoring engine
--
-- calc_kpi_score() is the SINGLE SOURCE OF TRUTH for every number this
-- system produces. src/lib/scoring.ts mirrors it exactly so the form can
-- show a live score while typing; tests assert the two agree.
--
-- Verified against KPI 26-27 Template.xlsx:
--   Response time      wt 25, target 100, achieved 100 -> 25.000
--   Documentation      wt 20, target  35, achieved  40 -> 17.500
--   Service quality    wt 10, target   0, achieved   0 -> 10.000
--   Service quality    wt 10, target   0, achieved   2 ->  0.000
-- =====================================================================

create or replace function calc_kpi_score(
  p_rule      text,
  p_weightage numeric,
  p_target    numeric,
  p_achieved  numeric,
  p_params    jsonb default '{}'::jsonb
) returns numeric
language plpgsql
immutable
as $$
declare
  wt          numeric := coalesce(p_weightage, 0);
  tgt         numeric := p_target;
  ach         numeric := p_achieved;
  params      jsonb   := coalesce(p_params, '{}'::jsonb);
  allow_neg   boolean := coalesce((params->>'allow_negative')::boolean, false);
  score_floor numeric := (params->>'floor')::numeric;
  max_mult    numeric := (params->>'max_multiplier')::numeric;
  ratio       numeric;
  result      numeric;
  band        jsonb;
  best_award  numeric;
  ach_pct     numeric;
begin
  -- Nothing entered yet. The spreadsheet's ISBLANK(...)=0 behaviour.
  -- NOTE: this is NULL, not zero. A genuine achieved value of 0 falls
  -- through and is scored, which is what makes "repeat calls = 0,
  -- target = 0" award full weightage.
  if ach is null then
    return 0;
  end if;

  case p_rule

    -- min(achieved/target, 1) x weightage
    when 'higher_capped' then
      if tgt is null or tgt = 0 then
        result := 0;                       -- matches Excel's IFERROR(...,0)
      else
        result := least(ach / tgt * wt, wt);
      end if;

    -- achieved/target x weightage, may pass the weightage
    when 'higher_uncapped' then
      if tgt is null or tgt = 0 then
        result := 0;
      else
        result := ach / tgt * wt;
        if max_mult is not null then
          result := least(result, wt * max_mult);
        end if;
      end if;

    -- at/under target = full; over target decays as wt x target/achieved
    when 'lower_penalty' then
      if tgt is null then
        result := 0;
      elsif ach <= tgt then
        result := wt;
      elsif ach = 0 then
        result := 0;                       -- unreachable guard on div-by-zero
      else
        result := wt * (tgt / ach);
      end if;

    -- every unit over target removes a proportional slice; can go negative
    when 'lower_linear' then
      if tgt is null then
        result := 0;
      elsif ach <= tgt then
        result := wt;
      elsif tgt = 0 then
        -- no proportional base to work from; fall back to a flat penalty
        -- per unit if one is configured, else zero
        result := wt - (ach * coalesce((params->>'penalty_per_unit')::numeric, wt));
      else
        result := wt * (1 - ((ach - tgt) / tgt));
      end if;

    -- stepped thresholds: [{"min_pct":95,"award_pct":100}, ...]
    when 'banded' then
      if tgt is null or tgt = 0 then
        result := 0;
      else
        ach_pct    := ach / tgt * 100;
        best_award := (params->>'default_award_pct')::numeric;
        for band in select * from jsonb_array_elements(coalesce(params->'bands','[]'::jsonb))
        loop
          if ach_pct >= (band->>'min_pct')::numeric then
            if best_award is null
               or (band->>'award_pct')::numeric > best_award then
              best_award := (band->>'award_pct')::numeric;
            end if;
          end if;
        end loop;
        result := wt * coalesce(best_award, 0) / 100;
      end if;

    when 'boolean' then
      result := case when ach >= 1 then wt else 0 end;

    -- 0-100 qualitative input scaled onto the weightage
    when 'rating_scale' then
      result := least(ach / 100 * wt, wt);

    else
      raise exception 'Unknown scoring rule: %', p_rule;
  end case;

  -- Clamp. Rules that cannot go negative are floored at 0 unless the
  -- item explicitly opts in via rule_params.allow_negative.
  if score_floor is not null then
    result := greatest(result, score_floor);
  elsif not allow_neg then
    result := greatest(result, 0);
  end if;

  return round(result, 4);
end $$;


-- =====================================================================
-- Recompute an item's scores, then roll the whole submission up.
-- =====================================================================

create or replace function recompute_submission_totals(p_submission_id uuid)
returns void
language plpgsql
as $$
declare
  blend       jsonb;
  self_w      numeric;
  mgr_w       numeric;
begin
  select value into blend from app_settings where key = 'score_blend';
  self_w := coalesce((blend->>'self_weight')::numeric,    0.5);
  mgr_w  := coalesce((blend->>'manager_weight')::numeric, 0.5);

  -- 1. per-item scores
  update kpi_submission_items i
  set
    self_score    = calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                   i.self_achieved, i.rule_params),
    manager_score = case
                      when i.manager_achieved is null then null
                      else calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                          i.manager_achieved, i.rule_params)
                    end,
    -- final stays NULL until the manager has actually scored the row.
    -- (The spreadsheet's AVERAGE(G,K) silently halved the score while
    --  the manager column was still blank -- we don't repeat that.)
    final_score   = case
                      when i.manager_achieved is null then null
                      else round(
                        self_w * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.self_achieved, i.rule_params)
                      + mgr_w  * calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                                i.manager_achieved, i.rule_params), 4)
                    end
  where i.submission_id = p_submission_id;

  -- 2. header roll-ups, split by section
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
      sum(self_score)  filter (where section = 'job_role')    as self_job,
      sum(self_score)  filter (where section = 'core_values') as self_core,
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
end $$;


create or replace function trg_recompute_submission()
returns trigger language plpgsql as $$
begin
  perform recompute_submission_totals(
    coalesce(new.submission_id, old.submission_id)
  );
  return null;
end $$;

drop trigger if exists trg_items_recompute on kpi_submission_items;
create trigger trg_items_recompute
  after insert or delete or update of
    self_achieved, manager_achieved, weightage, target_value, scoring_rule, rule_params
  on kpi_submission_items
  for each row execute function trg_recompute_submission();


-- =====================================================================
-- Core values: average the 5 qualitative ratings (Excellent=100 ...
-- Poor=20) and push the result into the core_values row's achieved
-- value, exactly like F8=AVERAGE(E11:E15) in the sheet.
-- =====================================================================

create or replace function sync_core_value_rollup()
returns trigger language plpgsql as $$
declare
  sid        uuid := coalesce(new.submission_id, old.submission_id);
  self_avg   numeric;
  mgr_avg    numeric;
  mirror     boolean;
begin
  select coalesce((value)::text::boolean, false) into mirror
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

  return null;
end $$;

drop trigger if exists trg_core_values_rollup on core_value_ratings;
create trigger trg_core_values_rollup
  after insert or update or delete on core_value_ratings
  for each row execute function sync_core_value_rollup();
