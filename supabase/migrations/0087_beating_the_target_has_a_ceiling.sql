-- =====================================================================
-- Cyrix KPI  ·  0087  ·  Beating the target has a ceiling: 120%
--
-- "Higher is better (can exceed weightage)" had no upper bound at all,
-- so a row worth 25% could return 60% if somebody came in at 240% of
-- target -- and a single extraordinary month on a single row could carry
-- a whole year. That is not what a weightage is for: the number is the
-- share of the appraisal that row is worth, and a share that can grow
-- without limit is not a share.
--
-- Management's ceiling is 120% of the weightage. A row worth 25% earns
-- at most 30%, however far past the target somebody goes.
--
-- The mechanism already existed -- rule_params.max_multiplier -- and was
-- opt-in per row, which meant nobody used it: one row of 1,148 has this
-- rule and it has no multiplier set. This makes 120% the default and
-- leaves the per-row override in place for anything that needs its own.
--
-- Nothing is rescored. No submitted row is above 120% of its weightage
-- today, so this changes no score already given; it changes what an
-- extraordinary month will earn from here on.
--
-- The same number is UNCAPPED_MAX_MULTIPLIER in src/lib/scoring.ts. That
-- one is what the screen shows while somebody types, this one is what
-- decides the appraisal, and they have to agree.
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
  -- 120% of the weightage, unless the row states its own. See
  -- UNCAPPED_MAX_MULTIPLIER in src/lib/scoring.ts, which has to
  -- agree with this or the screen and the score disagree.
  max_mult    numeric := coalesce((params->>'max_multiplier')::numeric, 1.2);
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
        result := least(ach / tgt * wt, wt * max_mult);
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
end $function$;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  got numeric;
begin
  -- 25% weightage, target 100. Double the target is capped at 30, not 50.
  got := calc_kpi_score('higher_uncapped', 25, 100, 200, '{}'::jsonb);
  if got <> 30 then raise exception 'Expected 30 at the ceiling, got %', got; end if;

  -- Exactly at the ceiling.
  got := calc_kpi_score('higher_uncapped', 25, 100, 120, '{}'::jsonb);
  if got <> 30 then raise exception 'Expected 30 at 120%%, got %', got; end if;

  -- Under the ceiling is untouched: beating the target still pays.
  got := calc_kpi_score('higher_uncapped', 25, 100, 110, '{}'::jsonb);
  if got <> 27.5 then raise exception 'Expected 27.5 at 110%%, got %', got; end if;

  -- At target, exactly the weightage.
  got := calc_kpi_score('higher_uncapped', 25, 100, 100, '{}'::jsonb);
  if got <> 25 then raise exception 'Expected the weightage at target, got %', got; end if;

  -- A row stating its own ceiling still wins.
  got := calc_kpi_score('higher_uncapped', 25, 100, 300, '{"max_multiplier": 2}'::jsonb);
  if got <> 50 then raise exception 'A stated multiplier was ignored: %', got; end if;

  -- And the capped rule is untouched by any of this.
  got := calc_kpi_score('higher_capped', 25, 100, 200, '{}'::jsonb);
  if got <> 25 then raise exception 'higher_capped changed: %', got; end if;

  raise notice '0087 self-test passed (uncapped rows stop at 120%% of weightage)';
end $$;
