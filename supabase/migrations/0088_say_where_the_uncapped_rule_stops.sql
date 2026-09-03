-- =====================================================================
-- Cyrix KPI  ·  0088  ·  The rule's own description says where it stops
--
-- 0087 gave "Higher is better (can exceed weightage)" a ceiling of 120%
-- of the weightage. Its description in scoring_rules still said the
-- score "keeps rising past the weightage" and stopped there, which is
-- now the wrong half of the truth -- and this is the sentence somebody
-- reads while choosing the rule on the setup screen, so it is the one
-- place the change most needs to be visible.
--
-- The worked example survives untouched, which is worth noticing: target
-- 50, weightage 10, 60 achieved scores 12, and 12 is exactly 120% of 10.
-- The example was already sitting on the ceiling. What it never said is
-- that 70 also scores 12, so that is what gets added.
-- =====================================================================

update scoring_rules
set description =
  'Score rises with what was achieved and keeps rising past the '
  'weightage, as far as 120% of it. Example: target 50 visits, '
  'weightage 10. 40 visits scores 8; 50 scores 10; 60 scores 12 — and '
  '12 is the most this row can earn, however far past the target it '
  'goes.'
where code = 'higher_uncapped';


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  d text;
begin
  select description into d from scoring_rules where code = 'higher_uncapped';
  if d is null then
    raise exception 'higher_uncapped has no description';
  end if;
  if d !~ '120' then
    raise exception 'The description does not state the ceiling: %', d;
  end if;

  -- The description and the arithmetic have to agree. This is the pair
  -- the sentence quotes.
  if calc_kpi_score('higher_uncapped', 10, 50, 60, '{}'::jsonb) <> 12 then
    raise exception 'The worked example no longer scores 12';
  end if;
  if calc_kpi_score('higher_uncapped', 10, 50, 70, '{}'::jsonb) <> 12 then
    raise exception 'The stated ceiling is not what the function does';
  end if;

  raise notice '0088 self-test passed (the rule says where it stops)';
end $$;
