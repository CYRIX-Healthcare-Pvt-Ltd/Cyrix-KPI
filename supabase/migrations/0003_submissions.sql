-- =====================================================================
-- Cyrix KPI  ·  0003  ·  Monthly submissions and scoring
--
-- One submission = one employee, one month (the "Apr-26" sheet).
-- Submission items FREEZE the KPI definition at the moment the month
-- opens, so a mid-year change to the assignment cannot silently rewrite
-- a month that has already been scored.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Global settings. self/manager blend lives here: the spreadsheet does
-- AVERAGE(self, manager) i.e. 50/50, but HR may want manager-only later
-- without a schema change.
-- ---------------------------------------------------------------------
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

insert into app_settings (key, value, description) values
  ('score_blend',
   '{"self_weight": 0.5, "manager_weight": 0.5}'::jsonb,
   'How self-assessment and manager assessment combine into the final score. Matches the template''s AVERAGE(G,K). Set self_weight to 0 for manager-only scoring.'),
  ('submission_window',
   '{"opens_day": 1, "closes_day": 7, "manager_closes_day": 14}'::jsonb,
   'Day of the following month when TM submission opens/closes and manager scoring closes.'),
  ('core_values_mirror_self',
   'false'::jsonb,
   'The spreadsheet had J8=F8, forcing the manager core-value rating to copy the TM''s. false = manager rates independently.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Monthly submission header.
--
-- State machine:
--   draft      TM is filling it in
--   submitted  TM done, sitting with the manager
--   returned   manager sent it back for correction  -> draft
--   scored     manager has entered their numbers
--   finalized  locked; this is what appraisal/PIP reads
-- ---------------------------------------------------------------------
create table if not exists kpi_submissions (
  id                    uuid primary key default gen_random_uuid(),
  assignment_id         uuid not null references kpi_assignments(id) on delete restrict,
  employee_id           uuid not null references employees(id) on delete cascade,
  manager_id            uuid references employees(id) on delete set null,
  financial_year        text not null references financial_years(code),
  period_month          date not null,        -- always the 1st: 2026-04-01

  status                text not null default 'draft'
                          check (status in ('draft','submitted','returned','scored','finalized')),

  self_submitted_at     timestamptz,
  manager_scored_at     timestamptz,
  finalized_at          timestamptz,
  returned_at           timestamptz,
  return_reason         text,

  employee_remarks      text,
  manager_remarks       text,

  -- denormalised roll-ups, recomputed by trigger on every item change
  self_job_role_score   numeric(9,4),
  self_core_score       numeric(9,4),
  self_total_score      numeric(9,4),
  mgr_job_role_score    numeric(9,4),
  mgr_core_score        numeric(9,4),
  mgr_total_score       numeric(9,4),
  final_job_role_score  numeric(9,4),
  final_core_score      numeric(9,4),
  final_total_score     numeric(9,4),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (employee_id, period_month),
  -- period_month must genuinely be the first of a month
  constraint submission_period_is_month_start
    check (period_month = date_trunc('month', period_month)::date)
);

create index if not exists idx_sub_employee on kpi_submissions(employee_id, period_month desc);
create index if not exists idx_sub_manager  on kpi_submissions(manager_id, status);
create index if not exists idx_sub_status   on kpi_submissions(status, period_month);
create index if not exists idx_sub_fy       on kpi_submissions(financial_year);

-- ---------------------------------------------------------------------
-- The scored rows. Columns F-N of the monthly sheet.
--   self_achieved    = column F  (TM types this)
--   self_score       = column G  (computed)
--   manager_achieved = column J  (manager types this)
--   manager_score    = column K  (computed)
--   final_score      = column N  (blend of the two)
-- ---------------------------------------------------------------------
create table if not exists kpi_submission_items (
  id                  uuid primary key default gen_random_uuid(),
  submission_id       uuid not null references kpi_submissions(id) on delete cascade,
  assignment_item_id  uuid references kpi_assignment_items(id) on delete set null,

  -- frozen definition
  section             text not null check (section in ('job_role','core_values')),
  kra                 text not null,
  kpi_description     text,
  weightage           numeric(7,3) not null,
  target_value        numeric(16,4),
  target_unit         text,
  scoring_rule        text not null references scoring_rules(code),
  rule_params         jsonb not null default '{}'::jsonb,

  -- assessment
  self_achieved       numeric(16,4),
  self_score          numeric(9,4),
  self_remarks        text,
  manager_achieved    numeric(16,4),
  manager_score       numeric(9,4),
  manager_remarks     text,
  final_score         numeric(9,4),

  sort_order          int not null default 0
);

create index if not exists idx_sub_items on kpi_submission_items(submission_id, sort_order);

-- ---------------------------------------------------------------------
-- Core value ratings -- the 5 qualitative rows that average into the
-- single core_values submission item.
-- ---------------------------------------------------------------------
create table if not exists core_value_ratings (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references kpi_submissions(id) on delete cascade,
  core_value_id   uuid not null references core_value_definitions(id) on delete cascade,
  self_rating     text references rating_scale(label),
  manager_rating  text references rating_scale(label),
  manager_remarks text,
  unique (submission_id, core_value_id)
);

drop trigger if exists trg_submissions_updated on kpi_submissions;
create trigger trg_submissions_updated before update on kpi_submissions
  for each row execute function set_updated_at();
