-- =====================================================================
-- Cyrix KPI  ·  0121  ·  The scorer takes the rate the screen shows
--
-- A manager re-scored a queried month, watched the row read 5.60, saved,
-- and the total did not move. Both numbers were doing what they were
-- told:
--
--   Documentation, weightage 10, target 0, achieved 22, -0.2 per unit
--     screen    10 - 22 x 0.2   = 5.60
--     database  10 x (0 / 22)   = 0.00
--
-- calcKpiScore in src/lib/scoring.ts was taught to take
-- penalty_per_unit on a lower_penalty row; calc_kpi_score was not, and
-- it is the one that decides an appraisal. On a target of 0 -- which is
-- most of these rows, "no pending RBER", "no repeat calls" -- the curve
-- is 0/achieved, so the row scored zero however well it went. That is
-- the shape the rate was added to fix.
--
-- 425 stored figures across 101 people disagree with what was on screen
-- when they were entered. This is the branch, and the recompute that
-- puts the scores where the managers put them.
--
-- Every other rule was checked row by row against the same 5,830
-- figures and agrees exactly; only lower_penalty with a stated rate
-- diverged.
--
-- The body below is the live definition read back with
-- pg_get_functiondef, with one branch spliced and nothing else retyped.
-- Same signature, so CREATE OR REPLACE and the grants stay as they are.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.calc_kpi_score(p_rule text, p_weightage numeric, p_target numeric, p_achieved numeric, p_params jsonb DEFAULT '{}'::jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  wt          numeric := coalesce(p_weightage, 0);
  tgt         numeric := p_target;
  ach         numeric := p_achieved;
  params      jsonb   := coalesce(p_params, '{}'::jsonb);
  -- The rule's own label promises this, so it is the default for the one
  -- rule that makes the promise. An explicit false still wins.
  allow_neg   boolean := coalesce((params->>'allow_negative')::boolean,
                                  p_rule = 'lower_linear');
  score_floor numeric := (params->>'floor')::numeric;
  -- No default ceiling. 0087 put 1.2 here on management's instruction
  -- and 0095 takes it back out on theirs: somebody who triples a target
  -- has tripled it, and a score that refuses to say so is one nobody
  -- trusts. A row that states its own max_multiplier still gets it.
  -- NULL means "no ceiling" and is read that way below. See
  -- UNCAPPED_MAX_MULTIPLIER in src/lib/scoring.ts, which has to agree
  -- with this or the screen and the score disagree.
  max_mult    numeric := (params->>'max_multiplier')::numeric;
  -- Zero is the absence of a penalty, not a penalty of nothing.
  per_unit    numeric := nullif(greatest((params->>'penalty_per_unit')::numeric, 0), 0);
  over        numeric;
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
        -- Only where the row asked for a ceiling.
        if max_mult is not null then
          result := least(result, wt * max_mult);
        end if;
      end if;

    -- at/under target = full; over it, the rate the row states, or the
    -- proportional curve when it states none
    when 'lower_penalty' then
      if tgt is null then
        result := 0;
      elsif ach <= tgt then
        result := wt;
      elsif per_unit is not null then
        -- A stated rate per unit over, exactly as lower_linear takes
        -- one. The two rules differ in one thing and it is the thing
        -- their names say: this one floors at zero below, the other
        -- keeps going down.
        --
        -- Without this branch the rate was accepted, shown on the row
        -- as "-0.3% per unit over", and then ignored here -- and on a
        -- target of 0 the curve below is 0/ach, so every one of those
        -- rows scored zero however well it went. calcKpiScore in
        -- src/lib/scoring.ts took the rate from the day it was offered;
        -- this is the same arithmetic, and until now the screen and the
        -- score disagreed on 425 figures.
        result := wt - ((ach - tgt) * per_unit);
      elsif ach = 0 then
        result := 0;                       -- unreachable guard on div-by-zero
      else
        result := wt * (tgt / ach);
      end if;

    -- every unit over target costs; can go negative
    when 'lower_linear' then
      if tgt is null then
        result := 0;
      elsif ach <= tgt then
        result := wt;
      else
        over := ach - tgt;
        if per_unit is not null then
          -- A stated penalty, in points off the total. Wins at every
          -- target, and is the only thing a weightage of 0 can use.
          result := wt - (over * per_unit);
        elsif tgt = 0 then
          -- No proportional base to work from. Falling back to the
          -- weightage means one over wipes the row out -- the behaviour
          -- that shipped, kept for anything relying on it.
          result := wt - (over * wt);
        else
          result := wt * (1 - (over / tgt));
        end if;
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

  -- Clamp. An explicit floor outranks everything.
  if score_floor is not null then
    result := greatest(result, score_floor);
  elsif not allow_neg then
    result := greatest(result, 0);
  end if;

  return round(result, 4);
end $function$

;

-- ---------------------------------------------------------------------
-- The arithmetic, before anything is rescored on it.
-- ---------------------------------------------------------------------
do $$
begin
  -- The case that started it.
  if calc_kpi_score('lower_penalty', 10, 0, 22, '{"penalty_per_unit":0.2}') <> 5.6 then
    raise exception 'a stated rate is still not taken';
  end if;
  -- At or under target is untouched by any of this.
  if calc_kpi_score('lower_penalty', 10, 0, 0, '{"penalty_per_unit":0.2}') <> 10 then
    raise exception 'nothing over target must still be full marks';
  end if;
  -- lower_penalty is the one that stops at zero: 60 units at 0.2 is 12
  -- off a weightage of 10.
  if calc_kpi_score('lower_penalty', 10, 0, 60, '{"penalty_per_unit":0.2}') <> 0 then
    raise exception 'lower_penalty must floor at zero';
  end if;
  -- And lower_linear is the one that does not.
  if calc_kpi_score('lower_linear', 10, 0, 60, '{"penalty_per_unit":0.2}') <> -2 then
    raise exception 'lower_linear must still go negative';
  end if;
  -- No rate stated: the proportional curve every row written before the
  -- rate existed relies on.
  if calc_kpi_score('lower_penalty', 10, 5, 10, '{}') <> 5 then
    raise exception 'the proportional curve has moved';
  end if;
  if calc_kpi_score('lower_penalty', 10, 0, 4, '{}') <> 0 then
    raise exception 'target 0 with no rate has moved';
  end if;
  -- A rate of zero is the absence of one, not a penalty of nothing.
  if calc_kpi_score('lower_penalty', 10, 5, 10, '{"penalty_per_unit":0}') <> 5 then
    raise exception 'a zero rate must read as unset';
  end if;
  raise notice '0121 arithmetic passed (the rate is taken, the floor holds, the curve is unchanged)';
end $$;


-- ---------------------------------------------------------------------
-- Every submission holding one of those rows, rescored on the corrected
-- function.
--
-- recompute_submission_totals is the routine the item trigger itself
-- calls, so this is the score those rows would have carried all along.
-- It writes only score columns, which trg_items_recompute does not
-- watch, so nothing cascades.
-- ---------------------------------------------------------------------
do $$
declare
  s record;
  n integer := 0;
begin
  for s in
    select distinct i.submission_id
    from kpi_submission_items i
    where i.scoring_rule = 'lower_penalty'
      and coalesce((i.rule_params->>'penalty_per_unit')::numeric, 0) > 0
  loop
    perform recompute_submission_totals(s.submission_id);
    n := n + 1;
  end loop;
  raise notice '0121 rescored % submission(s)', n;
end $$;


-- ---------------------------------------------------------------------
-- Self-test: no stored figure disagrees with the function any more.
-- ---------------------------------------------------------------------
do $$
declare
  bad integer;
begin
  select count(*) into bad
  from kpi_submission_items i
  where i.scoring_rule = 'lower_penalty'
    and coalesce((i.rule_params->>'penalty_per_unit')::numeric, 0) > 0
    and (
      (i.manager_achieved is not null
       and abs(coalesce(i.manager_score, -1)
               - calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                i.manager_achieved, i.rule_params)) > 0.0001)
      or
      (i.self_achieved is not null
       and abs(coalesce(i.self_score, -1)
               - calc_kpi_score(i.scoring_rule, i.weightage, i.target_value,
                                i.self_achieved, i.rule_params)) > 0.0001));

  if bad > 0 then
    raise exception '% row(s) still hold a score the function would not give', bad;
  end if;

  raise notice '0121 self-test passed (every rate row now stores what the screen shows)';
end $$;
