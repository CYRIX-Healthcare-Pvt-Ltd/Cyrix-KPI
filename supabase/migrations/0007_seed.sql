-- =====================================================================
-- Cyrix KPI  ·  0007  ·  Seed data taken verbatim from
--                        "KPI 26-27 Template.xlsx"
-- =====================================================================

insert into financial_years (code, starts_on, ends_on, is_current) values
  ('2025-26', '2025-04-01', '2026-03-31', false),
  ('2026-27', '2026-04-01', '2027-03-31', true),
  ('2027-28', '2027-04-01', '2028-03-31', false)
on conflict (code) do nothing;

-- The five core values, from rows 11-15 of the Apr-26 sheet.
insert into core_value_definitions (name, description, sort_order) values
  ('Continuous Learning',
   'Demonstrates a strong learning attitude and actively participates in training programs.', 1),
  ('Building Relationships',
   'Maintains a positive attitude toward managers, users, and client requests.', 2),
  ('Trust',
   'Exhibits punctuality, takes ownership and accountability, and ensures error-free documentation.', 3),
  ('Care',
   'Responds effectively to negative feedback, supports team members, and appreciates team contributions.', 4),
  ('Speed of Response',
   'Ensures timely responses to emails, calls, and all customer communications.', 5)
on conflict (name) do update
  set description = excluded.description, sort_order = excluded.sort_order;

insert into job_roles (name, description) values
  ('Service Engineer', 'Field service, breakdown response, preventive maintenance and installation.')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- The Service Engineer template, exactly as the spreadsheet defines it.
-- Scoring rules were derived from the actual cell formulas:
--   G4/G5  =IFERROR(MIN(F/E*D,D),0)                    -> higher_capped
--   G6/G7  =IF(F<=E,D,D-(D*(100%-(E/F))))              -> lower_penalty
--   G8     rating block averaged into MIN(F/E*D,D)     -> rating_scale
-- ---------------------------------------------------------------------
do $$
declare
  v_role_id uuid;
  v_tpl_id  uuid;
begin
  select id into v_role_id from job_roles where name = 'Service Engineer';

  select id into v_tpl_id from kpi_templates
  where job_role_id = v_role_id and financial_year = '2026-27' and version = 1;

  if v_tpl_id is null then
    insert into kpi_templates (job_role_id, name, version, financial_year, status, notes)
    values (v_role_id, 'Service Engineer KPI', 1, '2026-27', 'active',
            'Imported from KPI 26-27 Template.xlsx')
    returning id into v_tpl_id;
  end if;

  delete from kpi_template_items where template_id = v_tpl_id;

  insert into kpi_template_items
    (template_id, section, kra, kpi_description, weightage, target_value, target_unit, scoring_rule, sort_order)
  values
    (v_tpl_id, 'job_role', 'Response time',
     'BD calls assigned to be attended within 48 hours',
     25, 100, '%', 'higher_capped', 1),

    (v_tpl_id, 'job_role', 'Service delivery',
     '100% completion as per SLA (Breakdown, PM, Installation, Customer Visit)',
     25, 100, '%', 'higher_capped', 2),

    (v_tpl_id, 'job_role', 'Documentation & Reporting',
     'Submit service reports accurately and on time, GDP score should be 100% (previous month)',
     20, 35, 'count', 'lower_penalty', 3),

    (v_tpl_id, 'job_role', 'Service quality & reliability',
     'Repeated call within one month should be 0 (rejected calls 0)',
     10, 0, 'count', 'lower_penalty', 4),

    (v_tpl_id, 'core_values', 'Customer Delight',
     'Delivers a positive customer experience through responsiveness, accountability, strong communication, and continuous improvement, while building trust and effective relationships.',
     20, 100, 'score', 'rating_scale', 5);
end $$;


-- =====================================================================
-- Self-test: assert the engine reproduces the spreadsheet's own numbers.
-- Applying this migration fails loudly if the maths ever drifts.
-- =====================================================================
do $$
declare
  got numeric;
begin
  -- Response time: wt 25, target 100, achieved 100 -> full weightage
  got := calc_kpi_score('higher_capped', 25, 100, 100, '{}');
  if got <> 25 then raise exception 'higher_capped on-target: expected 25, got %', got; end if;

  -- half the target -> half the weightage
  got := calc_kpi_score('higher_capped', 25, 100, 50, '{}');
  if got <> 12.5 then raise exception 'higher_capped half: expected 12.5, got %', got; end if;

  -- 150% of target is still capped at the weightage
  got := calc_kpi_score('higher_capped', 25, 100, 150, '{}');
  if got <> 25 then raise exception 'higher_capped over: expected 25, got %', got; end if;

  -- same input, uncapped rule -> allowed past the weightage
  got := calc_kpi_score('higher_uncapped', 25, 100, 150, '{}');
  if got <> 37.5 then raise exception 'higher_uncapped: expected 37.5, got %', got; end if;

  -- uncapped with a 1.2x ceiling
  got := calc_kpi_score('higher_uncapped', 25, 100, 150, '{"max_multiplier":1.2}');
  if got <> 30 then raise exception 'higher_uncapped capped: expected 30, got %', got; end if;

  -- Documentation: wt 20, target 35, achieved 40 -> 20 * 35/40 = 17.5
  got := calc_kpi_score('lower_penalty', 20, 35, 40, '{}');
  if got <> 17.5 then raise exception 'lower_penalty over: expected 17.5, got %', got; end if;

  -- under target -> full weightage
  got := calc_kpi_score('lower_penalty', 20, 35, 30, '{}');
  if got <> 20 then raise exception 'lower_penalty under: expected 20, got %', got; end if;

  -- Service quality: target 0, achieved 0 -> full weightage
  got := calc_kpi_score('lower_penalty', 10, 0, 0, '{}');
  if got <> 10 then raise exception 'lower_penalty zero/zero: expected 10, got %', got; end if;

  -- Service quality: target 0, any repeat call -> zero
  got := calc_kpi_score('lower_penalty', 10, 0, 2, '{}');
  if got <> 0 then raise exception 'lower_penalty zero-target breach: expected 0, got %', got; end if;

  -- nothing entered -> zero (the ISBLANK branch)
  got := calc_kpi_score('lower_penalty', 10, 0, null, '{}');
  if got <> 0 then raise exception 'null achieved: expected 0, got %', got; end if;

  -- negative scoring: wt 10, target 5, achieved 15 -> 10*(1-2) = -10
  got := calc_kpi_score('lower_linear', 10, 5, 15, '{"allow_negative":true}');
  if got <> -10 then raise exception 'lower_linear negative: expected -10, got %', got; end if;

  -- same, but floored at zero by default
  got := calc_kpi_score('lower_linear', 10, 5, 15, '{}');
  if got <> 0 then raise exception 'lower_linear floored: expected 0, got %', got; end if;

  -- floor honoured when set explicitly
  got := calc_kpi_score('lower_linear', 10, 5, 15, '{"allow_negative":true,"floor":-5}');
  if got <> -5 then raise exception 'lower_linear floor: expected -5, got %', got; end if;

  -- core values: all Excellent -> 100 -> full 20
  got := calc_kpi_score('rating_scale', 20, 100, 100, '{}');
  if got <> 20 then raise exception 'rating_scale excellent: expected 20, got %', got; end if;

  -- mixed ratings averaging 60 -> 12
  got := calc_kpi_score('rating_scale', 20, 100, 60, '{}');
  if got <> 12 then raise exception 'rating_scale good: expected 12, got %', got; end if;

  -- banded
  got := calc_kpi_score('banded', 20, 100, 92,
          '{"bands":[{"min_pct":95,"award_pct":100},{"min_pct":85,"award_pct":75},{"min_pct":70,"award_pct":50}]}');
  if got <> 15 then raise exception 'banded: expected 15, got %', got; end if;

  got := calc_kpi_score('boolean', 15, 1, 1, '{}');
  if got <> 15 then raise exception 'boolean true: expected 15, got %', got; end if;

  raise notice 'Scoring engine self-test passed (18 assertions).';
end $$;
