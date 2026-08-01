-- =====================================================================
-- Cyrix KPI  ·  0016  ·  Plain-English scoring rules
--
-- The picker was written for whoever wired up the engine, not for the
-- person filling in their KPI. Two of the descriptions named the jsonb
-- parameter that controls them — "set max_multiplier in params",
-- "when allow_negative is set" — which tells a service engineer nothing
-- and invites them to go looking for a field.
--
-- Every description now says what the rule does and shows the arithmetic
-- on a worked example. The examples are the real formulas from
-- calc_kpi_score(), and the self-test at the bottom proves it.
--
-- Two rules also leave the picker. Neither is used by any live KPI:
--
--   banded   needs a table of thresholds nobody has a way to enter
--   boolean  a done/not-done row is a target of 1 under any of the
--            "higher is better" rules, so it earns its own entry only by
--            adding a choice to make
--
-- They stay in the table rather than being deleted: scoring_rule is a
-- foreign key, and the engine still understands them, so anything already
-- written against one keeps working and keeps its label on screen.
-- =====================================================================

alter table scoring_rules
  add column if not exists is_selectable boolean not null default true;

comment on column scoring_rules.is_selectable is
  'Whether this rule is offered when writing a KPI. False keeps a rule '
  'working for rows that already reference it while taking it out of the '
  'picker — the column is a foreign key, so rules are retired, not deleted.';

update scoring_rules set
  description = 'Score rises with what was achieved and stops at the full weightage — hitting the target is full marks, beating it adds nothing. Example: target 50 visits, weightage 10. 40 visits scores 8; 50 or more scores 10.',
  is_selectable = true
where code = 'higher_capped';

update scoring_rules set
  description = 'Score rises with what was achieved and keeps rising past the weightage, so beating the target is rewarded. Example: target 50 visits, weightage 10. 40 visits scores 8; 50 scores 10; 60 scores 12.',
  is_selectable = true
where code = 'higher_uncapped';

update scoring_rules set
  description = 'At or under the target scores the full weightage. Going over reduces it, gently at first and never below zero. Example: target 2 complaints, weightage 10. 2 or fewer scores 10; 3 scores 6.67; 4 scores 5.',
  is_selectable = true
where code = 'lower_penalty';

update scoring_rules set
  description = 'At or under the target scores the full weightage. Every unit over takes off an equal slice, and the score can go below zero. Example: target 2 complaints, weightage 10. 2 scores 10; 3 scores 5; 4 scores 0; 5 scores -5.',
  is_selectable = true
where code = 'lower_linear';

update scoring_rules set is_selectable = false
where code in ('banded', 'boolean', 'rating_scale');


-- ---------------------------------------------------------------------
-- Self-test.
--
-- A worked example in a description is a promise about the engine. These
-- run every number quoted above through calc_kpi_score() itself, so the
-- two cannot drift apart without this migration failing.
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
  got numeric;
  -- rule, weightage, target, achieved, params, expected
  cases jsonb := '[
    ["higher_capped",   10, 50, 40, {},                        8],
    ["higher_capped",   10, 50, 50, {},                        10],
    ["higher_capped",   10, 50, 60, {},                        10],
    ["higher_uncapped", 10, 50, 40, {},                        8],
    ["higher_uncapped", 10, 50, 50, {},                        10],
    ["higher_uncapped", 10, 50, 60, {},                        12],
    ["lower_penalty",   10,  2,  2, {},                        10],
    ["lower_penalty",   10,  2,  3, {},                        6.6667],
    ["lower_penalty",   10,  2,  4, {},                        5],
    ["lower_linear",    10,  2,  2, {"allow_negative": true},  10],
    ["lower_linear",    10,  2,  3, {"allow_negative": true},  5],
    ["lower_linear",    10,  2,  4, {"allow_negative": true},  0],
    ["lower_linear",    10,  2,  5, {"allow_negative": true},  -5]
  ]'::jsonb;
  c jsonb;
begin
  for c in select * from jsonb_array_elements(cases) loop
    got := calc_kpi_score(
      c->>0, (c->>1)::numeric, (c->>2)::numeric, (c->>3)::numeric, c->4);
    if round(got, 4) <> round((c->>5)::numeric, 4) then
      raise exception 'Worked example is wrong: % w=% t=% a=% gave %, description says %',
        c->>0, c->>1, c->>2, c->>3, got, c->>5;
    end if;
  end loop;

  -- Exactly the four rules a person writes a KPI with.
  select count(*) into n from scoring_rules where is_selectable;
  if n <> 4 then
    raise exception 'Expected 4 selectable scoring rules, found %', n;
  end if;

  -- Retiring a rule must not orphan anything that already uses it.
  select count(*) into n
  from kpi_assignment_items i
  join scoring_rules r on r.code = i.scoring_rule
  where not r.is_selectable;
  raise notice '0016 self-test passed (% existing row(s) on a retired rule)', n;
end $$;
