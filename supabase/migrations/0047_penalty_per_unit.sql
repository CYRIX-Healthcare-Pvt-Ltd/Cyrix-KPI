-- =====================================================================
-- Cyrix KPI  ·  0047  ·  A penalty that works at any target
--
-- "Monthly maximum one complaint. Every one after that costs 2% of the
-- total." That row cannot be written today, and two people have already
-- tried: both live rows on lower_linear carry weightage 0, because the
-- row is a penalty and not a share of the 80%. Both score exactly 0
-- whatever happens, and nothing on screen says so.
--
-- The reason is in the rule. Over target it removes a proportional slice
-- of the weightage — a share of nothing when the weightage is nothing —
-- and penalty_per_unit, the one figure in points rather than shares, was
-- only consulted when the target was 0. So the two ways of writing the
-- row each fail for a different reason: keep a target of 1 and the slice
-- is zero, drop to a target of 0 and the allowance goes with it.
--
-- Two changes:
--
--   1. penalty_per_unit applies at every target, not only 0. Each unit
--      over the target takes that many points off. Target 1, penalty 2,
--      three complaints -> -4, which comes straight off the total.
--
--   2. lower_linear allows negatives by default. The rule is named "can
--      go negative" on screen, but whether it could depended on a flag
--      the setup form set and the Excel importer did not.
--
-- Neither changes a stored score. No row anywhere has penalty_per_unit,
-- and both lower_linear rows already set allow_negative — verified
-- against the live database before writing this. Nothing is recomputed
-- for the same reason: there is nothing to recompute.
--
-- Mirrored in src/lib/scoring.ts. If you change a rule here, change it
-- there too.
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
  -- The rule's own label promises this, so it is the default for the one
  -- rule that makes the promise. An explicit false still wins.
  allow_neg   boolean := coalesce((params->>'allow_negative')::boolean,
                                  p_rule = 'lower_linear');
  score_floor numeric := (params->>'floor')::numeric;
  max_mult    numeric := (params->>'max_multiplier')::numeric;
  per_unit    numeric := (params->>'penalty_per_unit')::numeric;
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
end $$;


-- ---------------------------------------------------------------------
-- The picker's description, now that the rule can do one more thing.
-- ---------------------------------------------------------------------
update scoring_rules set
  description =
    'At or under the target scores the full weightage. Every unit over takes off an equal slice, and the score can go below zero. '
    'Example: target 2 complaints, weightage 10. 2 scores 10; 3 scores 5; 4 scores 0; 5 scores -5. '
    'Or set a fixed % to take off the total per unit over, which is how a row with no weightage of its own still counts: '
    'target 1 complaint, 2% per unit, 3 complaints takes 4% off the total.'
where code = 'lower_linear';


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Every number quoted in a description, plus the cases this migration
-- exists for. The worked examples from 0016 are repeated deliberately:
-- they are the regression check that generalising the penalty branch
-- left the proportional one alone.
-- ---------------------------------------------------------------------
do $$
declare
  got numeric;
  -- rule, weightage, target, achieved, params, expected, what
  cases jsonb := '[
    ["lower_linear", 10, 2, 2, {},                        10, "at target, full weightage"],
    ["lower_linear", 10, 2, 3, {},                         5, "one over, half the slice"],
    ["lower_linear", 10, 2, 4, {},                         0, "two over, nothing left"],
    ["lower_linear", 10, 2, 5, {},                        -5, "three over, negative without being asked"],
    ["lower_linear", 10, 2, 5, {"allow_negative": true},  -5, "and the same when asked"],
    ["lower_linear", 10, 2, 5, {"allow_negative": false},  0, "an explicit no still floors at zero"],

    ["lower_linear",  0, 1, 0, {"penalty_per_unit": 2},    0, "under an allowance of one costs nothing"],
    ["lower_linear",  0, 1, 1, {"penalty_per_unit": 2},    0, "the allowance itself is free"],
    ["lower_linear",  0, 1, 2, {"penalty_per_unit": 2},   -2, "one over the allowance costs 2%"],
    ["lower_linear",  0, 1, 3, {"penalty_per_unit": 2},   -4, "two over costs 4%"],
    ["lower_linear",  0, 1, 3, {},                         0, "and without a penalty, still nothing"],

    ["lower_linear", 10, 2, 4, {"penalty_per_unit": 1.5},  7, "a penalty overrides the slice where both could apply"],
    ["lower_linear",  0, 0, 2, {"penalty_per_unit": 2},   -4, "target 0 keeps using the penalty as it always did"],
    ["lower_linear", 10, 0, 1, {},                         0, "target 0 with no penalty still costs the weightage"],
    ["lower_linear", 10, 0, 2, {},                       -10, "and keeps going past zero"],
    ["lower_linear",  0, 1, 5, {"penalty_per_unit": 2, "floor": -5}, -5, "an explicit floor caps the damage"],

    ["higher_capped",   10, 50, 60, {},                   10, "untouched: capped stays capped"],
    ["higher_uncapped", 10, 50, 60, {},                   12, "untouched: uncapped stays uncapped"],
    ["lower_penalty",   10,  2,  4, {},                    5, "untouched: the gentle penalty is unchanged"],
    ["lower_penalty",   10,  2, 99, {},              0.2020, "untouched: and still cannot go negative"]
  ]'::jsonb;
  c jsonb;
begin
  for c in select * from jsonb_array_elements(cases) loop
    got := calc_kpi_score(
      c->>0, (c->>1)::numeric, (c->>2)::numeric, (c->>3)::numeric, c->4);
    if round(got, 4) <> round((c->>5)::numeric, 4) then
      raise exception '% -- % w=% t=% a=% params=% gave %, expected %',
        c->>6, c->>0, c->>1, c->>2, c->>3, c->4, got, c->>5;
    end if;
  end loop;

  raise notice '0047 self-test passed (% cases)', jsonb_array_length(cases);
end $$;


-- ---------------------------------------------------------------------
-- The description is a promise about the engine, so run its numbers
-- through the engine. Same guard 0016 put on the other three.
-- ---------------------------------------------------------------------
do $$
declare
  d text;
begin
  select description into d from scoring_rules where code = 'lower_linear';

  if calc_kpi_score('lower_linear', 0, 1, 3, '{"penalty_per_unit": 2}'::jsonb) <> -4 then
    raise exception 'The worked example in the lower_linear description is wrong';
  end if;
  if position('takes 4% off the total' in d) = 0 then
    raise exception 'The lower_linear description lost its worked example';
  end if;

  raise notice '0047 description matches the engine';
end $$;
