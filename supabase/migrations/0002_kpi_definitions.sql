-- =====================================================================
-- Cyrix KPI  ·  0002  ·  KPI definitions: templates, assignments, items
--
-- THE CORE DESIGN DECISION
-- ------------------------
-- Every TM's KPI is *structurally* identical -- a list of scored rows
-- split into "Job Role - 80%" and "Alignment To Core Values - 20%".
-- Only the rows themselves differ from person to person.
--
-- So KPIs are stored as ROWS IN A CHILD TABLE, never as a column per
-- KPI and never as an opaque JSON blob. A TM with 4 KRAs and a TM with
-- 11 KRAs use the same tables.
--
-- Templates are the reusable per-job-role starting point.
-- Assignments are a SNAPSHOT copied from a template onto one employee
-- for one financial year, and are then freely editable for that person.
-- The snapshot is what makes history immutable: editing next year's
-- template can never retroactively change a past appraisal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Scoring rules.  A table rather than an enum so a new rule is a data
-- change plus one branch in calc_kpi_score(), not a migration.
--
--   higher_capped     achieved/target x wt, CAPPED at wt
--                     "target achieved => max score is the weightage"
--   higher_uncapped   achieved/target x wt, may EXCEED wt
--                     "if target exceeds it can cross weightage value"
--   lower_penalty     <= target => full wt; above target => wt x target/achieved
--                     "if target exceeds my score should reduce"
--   lower_linear      wt x (1 - (achieved-target)/target), may go NEGATIVE
--                     "negative score"
--   banded            stepped thresholds from rule_params.bands
--   boolean           done / not done
--   rating_scale      0-100 qualitative input scaled to wt (core values)
-- ---------------------------------------------------------------------
create table if not exists scoring_rules (
  code          text primary key,
  label         text not null,
  description   text not null,
  direction     text not null check (direction in ('higher_better','lower_better','neutral')),
  can_exceed    boolean not null default false,
  can_be_negative boolean not null default false,
  sort_order    int not null default 0
);

insert into scoring_rules (code, label, description, direction, can_exceed, can_be_negative, sort_order) values
  ('higher_capped',   'Higher is better (capped at weightage)',
   'Score rises with achievement and stops at the full weightage. Hitting target = full marks; overachieving adds nothing.',
   'higher_better', false, false, 1),
  ('higher_uncapped', 'Higher is better (can exceed weightage)',
   'Score rises with achievement and may go past the weightage. Set max_multiplier in params to cap it (e.g. 1.2 = up to 120% of weightage).',
   'higher_better', true, false, 2),
  ('lower_penalty',   'Lower is better (proportional penalty)',
   'At or under target = full weightage. Above target the score decays as weightage x target/achieved.',
   'lower_better', false, false, 3),
  ('lower_linear',    'Lower is better (linear, can go negative)',
   'Every unit over target removes a proportional slice of the weightage. Can drop below zero when allow_negative is set.',
   'lower_better', false, true, 4),
  ('banded',          'Banded / stepped thresholds',
   'Achievement percentage falls into a band, each band awarding a fixed percentage of the weightage.',
   'higher_better', true, true, 5),
  ('boolean',         'Done / not done',
   'Full weightage when achieved, zero otherwise.',
   'neutral', false, false, 6),
  ('rating_scale',    'Qualitative rating (0-100)',
   'A 0-100 qualitative input scaled onto the weightage. Used by the core values block.',
   'higher_better', false, false, 7)
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  direction = excluded.direction,
  can_exceed = excluded.can_exceed,
  can_be_negative = excluded.can_be_negative,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Reusable templates, one per job role per financial year.
-- ---------------------------------------------------------------------
create table if not exists kpi_templates (
  id              uuid primary key default gen_random_uuid(),
  job_role_id     uuid references job_roles(id) on delete set null,
  name            text not null,
  version         int  not null default 1,
  financial_year  text references financial_years(code),
  status          text not null default 'draft'
                    check (status in ('draft','active','archived')),
  notes           text,
  created_by      uuid references employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_role_id, financial_year, version)
);

create table if not exists kpi_template_items (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references kpi_templates(id) on delete cascade,
  section         text not null check (section in ('job_role','core_values')),
  kra             text not null,
  kpi_description text,
  weightage       numeric(7,3) not null check (weightage >= 0),
  target_value    numeric(16,4),
  target_unit     text,
  scoring_rule    text not null references scoring_rules(code),
  rule_params     jsonb not null default '{}'::jsonb,
  sort_order      int not null default 0
);

create index if not exists idx_tpl_items on kpi_template_items(template_id, sort_order);

-- ---------------------------------------------------------------------
-- ASSIGNMENTS -- one employee, one financial year, one snapshot.
--
-- Flow (TM uploads own, manager must approve):
--   draft -> pending_approval -> active
--                             -> rejected -> (back to draft)
-- Only an `active` assignment can generate monthly submissions.
-- ---------------------------------------------------------------------
create table if not exists kpi_assignments (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id) on delete cascade,
  financial_year      text not null references financial_years(code),
  source_template_id  uuid references kpi_templates(id) on delete set null,

  status              text not null default 'draft'
                        check (status in ('draft','pending_approval','active','rejected','archived')),

  -- the 80/20 split, kept as data so a future role could differ
  job_role_weight     numeric(6,3) not null default 80,
  core_values_weight  numeric(6,3) not null default 20,

  submitted_at        timestamptz,
  submitted_by        uuid references employees(id) on delete set null,
  approved_at         timestamptz,
  approved_by         uuid references employees(id) on delete set null,
  rejection_reason    text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- At most ONE assignment per employee per FY that is still live.
-- Rejected/archived rows may pile up; active/draft/pending may not.
create unique index if not exists idx_assignment_one_live
  on kpi_assignments(employee_id, financial_year)
  where status in ('draft','pending_approval','active');

create index if not exists idx_assignment_employee on kpi_assignments(employee_id, financial_year);
create index if not exists idx_assignment_status   on kpi_assignments(status);

-- The actual KPI rows for this person. Copied from the template on
-- creation, then edited freely -- this is where "every TM is different"
-- physically lives.
create table if not exists kpi_assignment_items (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references kpi_assignments(id) on delete cascade,
  section          text not null check (section in ('job_role','core_values')),
  kra              text not null,
  kpi_description  text,
  weightage        numeric(7,3) not null check (weightage >= 0),
  target_value     numeric(16,4),
  target_unit      text,
  scoring_rule     text not null references scoring_rules(code),
  rule_params      jsonb not null default '{}'::jsonb,
  sort_order       int not null default 0
);

create index if not exists idx_assign_items on kpi_assignment_items(assignment_id, sort_order);

drop trigger if exists trg_assignments_updated on kpi_assignments;
create trigger trg_assignments_updated before update on kpi_assignments
  for each row execute function set_updated_at();

drop trigger if exists trg_templates_updated on kpi_templates;
create trigger trg_templates_updated before update on kpi_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Core values -- the 5 sub-ratings that roll up into the 20% block.
-- ---------------------------------------------------------------------
create table if not exists core_value_definitions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

-- Excellent=100 ... Poor=20, exactly as the template's nested IF chain.
create table if not exists rating_scale (
  label      text primary key,
  points     numeric(6,2) not null,
  sort_order int not null
);

insert into rating_scale (label, points, sort_order) values
  ('Excellent',    100, 1),
  ('Very Good',     80, 2),
  ('Good',          60, 3),
  ('Satisfactory',  40, 4),
  ('Poor',          20, 5)
on conflict (label) do update
  set points = excluded.points, sort_order = excluded.sort_order;
