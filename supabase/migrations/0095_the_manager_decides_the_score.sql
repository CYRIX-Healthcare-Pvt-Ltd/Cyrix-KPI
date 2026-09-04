-- =====================================================================
-- Cyrix KPI  ·  0095  ·  The manager decides the score, and beating the
--                        target has no ceiling again
--
-- Two decisions from management after the demo, both reversing something
-- this system currently does.
--
-- 1. The final score was the average of the employee's own figure and
--    the manager's. Management's position is that the appraisal is the
--    manager's judgement, and a self-assessment that drags a manager's
--    70 up to 78 is the employee marking their own work. The employee's
--    figure stays recorded and visible -- it is what the manager scores
--    against, and it is what a score query disputes -- it simply stops
--    counting toward the total.
--
--    Nothing here changes shape: 0004 already read the split from
--    app_settings.score_blend, and it has sat at 0.5/0.5 since. So this
--    is a setting moving to 0/1 and every month recomputed through the
--    function that owns the arithmetic, rather than new code.
--
-- 2. The 120% ceiling from 0087 comes off. It was management's own
--    suggestion a fortnight ago -- 25% weightage should earn at most 30
--    -- and the floor's answer is that somebody who triples a target has
--    tripled it. Ranking is what the ceiling was really protecting, and
--    0096 solves that properly with a band slab, so the score itself no
--    longer needs to lie about what happened.
--
-- Both are reversible: the blend is a row, and the ceiling is a default
-- in one expression.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The manager's figure is the final figure.
-- ---------------------------------------------------------------------
insert into app_settings (key, value)
values ('score_blend', '{"self_weight": 0, "manager_weight": 1}'::jsonb)
on conflict (key) do update set value = excluded.value;

comment on table app_settings is
  'Runtime settings. score_blend decides how much of the final score is '
  'the employee''s own assessment and how much is the manager''s; it is '
  '0/1 -- the manager decides -- and the employee''s figure is kept for '
  'comparison rather than for counting.';


-- ---------------------------------------------------------------------
-- 2. No ceiling on beating a target.
--
-- This is the live definition with two edits: the max_mult default, and
-- the one line that applied it. It is reproduced in full because that is
-- how CREATE OR REPLACE works, not because it was retyped.
--
-- Retyping it was the first attempt and it was wrong in four places --
-- it dropped the `banded` rule entirely, zeroed lower_penalty where the
-- real one decays as wt * (target/achieved), returned null instead of 0
-- on a null achieved, and lost the allow_negative default that
-- lower_linear's own label promises. None of that would have failed
-- loudly; it would have quietly rescored the company. A scoring function
-- is the last place to trust a rewrite from memory.
-- ---------------------------------------------------------------------
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


comment on function public.calc_kpi_score(text, numeric, numeric, numeric, jsonb) is
  'One KRA row to a score. higher_uncapped has no ceiling unless the row '
  'itself sets rule_params.max_multiplier. Mirrored by calcKpiScore in '
  'src/lib/scoring.ts -- the two must agree.';


-- ---------------------------------------------------------------------
-- Every existing month, through the function that owns these numbers.
--
-- Recomputed rather than arithmetic on the stored figures, so a month
-- rolled up under the old rule ends up identical to one rolled up today.
-- Finalized months included: leaving them on the old blend would make a
-- year average the mean of two different definitions of "final", which
-- is worse than a restated figure people can be told about.
-- ---------------------------------------------------------------------
do $$
declare
  s record;
  n int := 0;
begin
  for s in select id from kpi_submissions loop
    perform recompute_submission_totals(s.id);
    n := n + 1;
  end loop;
  raise notice '0095 recomputed % submission(s)', n;
end $$;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  got numeric;
  bad int;
begin
  -- The ceiling is gone: 300 against a target of 100 on a 25% row is
  -- three times the weightage, not 1.2 times it.
  got := calc_kpi_score('higher_uncapped', 25, 100, 300, '{}'::jsonb);
  if got <> 75 then
    raise exception 'uncapped should be 75, got %', got;
  end if;

  -- A row that declares its own ceiling still gets one.
  got := calc_kpi_score('higher_uncapped', 25, 100, 300, '{"max_multiplier": 2}'::jsonb);
  if got <> 50 then
    raise exception 'a declared ceiling should still bind, got %', got;
  end if;

  -- Capped is untouched.
  got := calc_kpi_score('higher_capped', 25, 100, 300, '{}'::jsonb);
  if got <> 25 then
    raise exception 'capped should still stop at the weightage, got %', got;
  end if;

  -- And the blend really is the manager's figure alone.
  select count(*) into bad
  from kpi_submissions
  where mgr_total_score is not null
    and final_total_score is distinct from mgr_total_score;
  if bad > 0 then
    raise exception '% scored month(s) still disagree with the manager''s figure', bad;
  end if;

  raise notice '0095 self-test passed (no ceiling; final equals the manager)';
end $$;
