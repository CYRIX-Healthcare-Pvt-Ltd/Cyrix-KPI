-- =====================================================================
-- Cyrix KPI  ·  0048  ·  Nought per cent is not a penalty
--
-- 0047 read any penalty_per_unit that was present, including 0. A row
-- set that way carries the can-go-negative rule, shows a mark reading
-- "-0% per unit over", and can never take anything off — configured to
-- do nothing, which is the exact state 0047 exists to make impossible.
--
-- So 0 reads as unset rather than as a penalty of nothing: the row falls
-- back to the proportional slice, and where there is no weightage to
-- take a slice of, the setup form refuses to submit it at all.
--
-- The form now asks for a minimum of 1. This is the same rule in the
-- engine, because a minimum in a form is a suggestion and the engine is
-- where the arithmetic actually happens.
--
-- No stored score changes: nothing in the database has the key at all.
-- Mirrored in src/lib/scoring.ts.
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
-- Self-test. 0047's cases in full, because this rewrote the whole
-- function, plus what a zero and a negative now do.
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
    ["lower_linear", 10, 2, 5, {"allow_negative": false},  0, "an explicit no still floors at zero"],

    ["lower_linear",  0, 1, 1, {"penalty_per_unit": 2},    0, "the allowance itself is free"],
    ["lower_linear",  0, 1, 2, {"penalty_per_unit": 2},   -2, "one over the allowance costs 2%"],
    ["lower_linear",  0, 1, 3, {"penalty_per_unit": 2},   -4, "two over costs 4%"],
    ["lower_linear", 10, 2, 4, {"penalty_per_unit": 1.5},  7, "a penalty overrides the slice"],
    ["lower_linear",  0, 0, 2, {"penalty_per_unit": 2},   -4, "target 0 keeps using the penalty"],
    ["lower_linear", 10, 0, 2, {},                       -10, "target 0 with no penalty costs the weightage"],
    ["lower_linear",  0, 1, 5, {"penalty_per_unit": 2, "floor": -5}, -5, "a floor caps the damage"],

    ["lower_linear",  0, 1, 9, {"penalty_per_unit": 0},    0, "0% off is no penalty, and 0% weightage has no slice"],
    ["lower_linear", 10, 2, 4, {"penalty_per_unit": 0},    0, "0% off falls back to the proportional slice"],
    ["lower_linear", 10, 2, 5, {"penalty_per_unit": 0},   -5, "and the slice still goes negative"],
    ["lower_linear", 10, 2, 4, {"penalty_per_unit": -3},   0, "a negative penalty cannot pay somebody for missing"],

    ["higher_capped",   10, 50, 60, {},                   10, "untouched: capped stays capped"],
    ["higher_uncapped", 10, 50, 60, {},                   12, "untouched: uncapped stays uncapped"],
    ["higher_uncapped", 10, 50, 1000, {"max_multiplier": 1.2}, 12, "untouched: the multiplier ceiling holds"],
    ["lower_penalty",   10,  2,  4, {},                    5, "untouched: the gentle penalty is unchanged"],
    ["lower_penalty",   10,  2, 99, {},              0.2020, "untouched: and still cannot go negative"],
    ["rating_scale",    20, 100, 60, {},                  12, "untouched: core values still scale"],
    ["boolean",         15,   1,  1, {},                  15, "untouched: all or nothing"]
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

  -- A blank achieved is still blank, not a zero.
  if calc_kpi_score('lower_linear', 0, 1, null, '{"penalty_per_unit": 2}'::jsonb) <> 0 then
    raise exception 'A month nobody has filled in must not score a penalty';
  end if;

  raise notice '0048 self-test passed (% cases)', jsonb_array_length(cases);
end $$;
