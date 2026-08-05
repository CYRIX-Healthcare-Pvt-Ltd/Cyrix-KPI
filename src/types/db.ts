import type { ScoringRule, RuleParams } from '@/lib/scoring'

/**
 * The weighted bands a KPI is divided into.
 *
 * Job role is always 80%. The remaining 20% is core values alone, or
 * core values at 15% alongside ESMS at 5% for the people who carry an
 * ESMS obligation — see set_esms().
 */
export type Section = 'job_role' | 'core_values' | 'esms'

export type AssignmentStatus =
  | 'draft' | 'pending_approval' | 'active' | 'rejected' | 'archived'

export type SubmissionStatus =
  | 'draft' | 'submitted' | 'returned' | 'scored' | 'finalized'

export interface Employee {
  id: string
  ecode: string
  full_name: string
  work_email: string | null
  designation: string | null
  department: string | null
  function_name: string | null
  grade: string | null
  location: string | null
  job_role_id: string | null
  reporting_manager_id: string | null
  date_of_joining: string | null
  is_active: boolean
  auth_user_id: string | null
  must_change_password: boolean
  /**
   * A 128px square JPEG as a base64 data URL — small enough to travel
   * with the row rather than costing a signed URL per face. Null when
   * nobody has set one, and null again once a manager has taken it down.
   */
  avatar: string | null
  avatar_updated_at: string | null
  /** Set when a manager removed it. Shown to the person, so they know. */
  avatar_removed_at: string | null
  avatar_removed_by: string | null
  avatar_removed_reason: string | null
}

/**
 * Where one person stands for a year — see kpi_ranking().
 *
 * Ranked among the people who have a score, not among everyone: 40th of
 * 340 means something, 40th of 1,146 because 800 have not been assessed
 * does not. team_size is the whole team either way, so the screen can
 * say both.
 */
export interface KpiRanking {
  employee_id: string
  financial_year: string
  score: number | null
  team_rank: number | null
  team_of: number | null
  org_rank: number | null
  org_of: number | null
  team_size: number
  /**
   * Standing among managers on the share of their team's submissions
   * turned around inside the allowance — ties broken by turnaround, so
   * the sort runs in two directions at once.
   *
   * Null for anyone with no reports, and for a manager with nothing yet
   * answerable. answerable / on_time_count are the two numbers the
   * percentage came from, so the screen can show its working.
   */
  mgr_rank: number | null
  mgr_of: number | null
  /**
   * Of every month the whole team owes — not only the ones that reached
   * the manager. The same figure as scored_pct on their row in HR's
   * report.
   */
  completion_pct: number | null
  due_months: number | null
  scored_months: number | null
  /** Months the team sent in: how long they took to send them. */
  submit_tat: number | null
  /** Months that are scored: how long they took. */
  completion_tat: number | null
  /** Months that are not: how long they have waited, counted to today. */
  pending_tat: number | null
  /**
   * The same three clocks with the cool-off period taken off, floored at
   * zero — how late, rather than how long. Null before the month SW
   * Admin set the counting to start from. See set_tat_policy().
   */
  submit_delay: number | null
  completion_delay: number | null
  pending_delay: number | null
  /** The allowance these delays were measured against, so a screen can
   *  say where the number came from without a second round trip. */
  tm_grace_days: number
  mgr_grace_days: number
  tat_starts_from: string | null
}

export interface JobRole {
  id: string
  name: string
  description: string | null
  is_active: boolean
}

export interface FinancialYear {
  code: string
  starts_on: string
  ends_on: string
  is_current: boolean
}

export interface ScoringRuleMeta {
  code: ScoringRule
  label: string
  description: string
  direction: 'higher_better' | 'lower_better' | 'neutral'
  can_exceed: boolean
  can_be_negative: boolean
  /** Offered when writing a KPI. Retired rules stay readable, not pickable. */
  is_selectable: boolean
  sort_order: number
}

export interface KpiTemplate {
  id: string
  job_role_id: string | null
  name: string
  version: number
  financial_year: string | null
  status: 'draft' | 'active' | 'archived'
  notes: string | null
}

/** Shared shape of a KPI row across templates, assignments and submissions. */
export interface KpiRowDefinition {
  section: Section
  kra: string
  kpi_description: string | null
  weightage: number
  target_value: number | null
  target_unit: string | null
  scoring_rule: ScoringRule
  rule_params: RuleParams
  sort_order: number
}

export interface KpiTemplateItem extends KpiRowDefinition {
  id: string
  template_id: string
}

export interface KpiAssignment {
  id: string
  employee_id: string
  financial_year: string
  source_template_id: string | null
  status: AssignmentStatus
  job_role_weight: number
  core_values_weight: number
  /** 5 for the people who carry ESMS, 0 for everyone else. */
  esms_weight: number
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  rejection_reason: string | null
}

/**
 * Another thing the same row could measure in a given month.
 *
 * No weightage of its own — it borrows the row's, which is the whole
 * point. One with its own weightage would be a second row, and the year
 * would stop totalling 100.
 */
export interface Alternate {
  id: string
  kra: string
  kpi_description: string | null
  target_value: number | null
  target_unit?: string | null
  scoring_rule: ScoringRule
  rule_params: RuleParams
}

export interface KpiAssignmentItem extends KpiRowDefinition {
  id: string
  assignment_id: string
  alternates: Alternate[]
}

export interface KpiSubmission {
  id: string
  assignment_id: string
  employee_id: string
  manager_id: string | null
  financial_year: string
  period_month: string
  status: SubmissionStatus
  self_submitted_at: string | null
  manager_scored_at: string | null
  finalized_at: string | null
  returned_at: string | null
  return_reason: string | null
  employee_remarks: string | null
  manager_remarks: string | null
  self_job_role_score: number | null
  /** Null for anyone who carries no ESMS — not zero, it does not apply. */
  self_esms_score: number | null
  self_core_score: number | null
  self_total_score: number | null
  mgr_job_role_score: number | null
  mgr_esms_score: number | null
  mgr_core_score: number | null
  mgr_total_score: number | null
  final_job_role_score: number | null
  final_esms_score: number | null
  final_core_score: number | null
  final_total_score: number | null
}

export interface KpiSubmissionItem extends KpiRowDefinition {
  id: string
  submission_id: string
  assignment_item_id: string | null
  /** Which alternative is in play this month. Null is the row as written. */
  alternate_id: string | null
  self_achieved: number | null
  self_score: number | null
  self_remarks: string | null
  manager_achieved: number | null
  manager_score: number | null
  manager_remarks: string | null
  final_score: number | null
}

export interface CoreValueDefinition {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export interface CoreValueRating {
  id: string
  submission_id: string
  core_value_id: string
  self_rating: string | null
  manager_rating: string | null
  manager_remarks: string | null
}

export interface AnnualSummary {
  employee_id: string
  ecode: string
  full_name: string
  reporting_manager_id: string | null
  financial_year: string
  months_finalized: number
  months_scored: number
  avg_job_role_score: number | null
  /** Null all year for anyone who carries no ESMS. */
  avg_esms_score: number | null
  avg_core_values_score: number | null
  avg_total_score: number | null
  lowest_month: number | null
  highest_month: number | null
}

export type RemovalStatus = 'pending' | 'approved' | 'rejected'

export interface TmRemovalRequest {
  id: string
  employee_id: string
  requested_by: string
  reason: string
  last_working_day: string | null
  status: RemovalStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
}

/**
 * Deleting a submitted month, and revising a KPI that is already
 * approved. Two subjects, one shape: both need the reporting manager and
 * then HR, and neither is reversible once HR says yes.
 */
export type RequestStage =
  | 'pending_manager' | 'pending_hr' | 'approved' | 'rejected'

interface TwoStageRequest {
  id: string
  employee_id: string
  requested_by: string
  reason: string
  status: RequestStage
  manager_id: string | null
  manager_decided_at: string | null
  manager_note: string | null
  hr_id: string | null
  hr_decided_at: string | null
  hr_note: string | null
  created_at: string
}

export interface DeletionRequest extends TwoStageRequest {
  submission_id: string
  period_month: string
}

export interface RevisionRequest extends TwoStageRequest {
  assignment_id: string
  financial_year: string
}

export type RecordRequest =
  | ({ kind: 'deletion' } & DeletionRequest)
  | ({ kind: 'revision' } & RevisionRequest)

/**
 * A row of the HR report. Whichever dimensions were not grouped on come
 * back null, so the table can drop those columns without knowing which
 * shape it asked for.
 */
export interface KpiReportRow {
  function_name: string | null
  department: string | null
  manager_id: string | null
  manager_ecode: string | null
  manager_name: string | null
  team: number
  scored: number
  to_score: number
  /** Has a KPI for the year but has not sent the month in. */
  not_submitted: number
  /** No agreed KPI at all, so cannot submit anything. */
  kpi_not_set: number
  scored_pct: number | null
  avg_score: number | null
  /** Months the team sent in: how long they took to send them. */
  submit_tat: number | null
  /** Months that are scored: how long they took. */
  completion_tat: number | null
  /** Months that are not: how long they have waited, counted to today. */
  pending_tat: number | null
  /** The same three, less the cool-off period: how late, not how long. */
  submit_delay: number | null
  completion_delay: number | null
  pending_delay: number | null
}

/**
 * One thing somebody else has put in the signed-in person's court — see
 * my_notifications(). Never their own state: nobody is notified that
 * they have not done their own work, because the dashboard says that on
 * the way in and saying it twice is how a tray gets ignored.
 *
 * The database returns the fact and nothing else; the wording, the icon
 * and the link all live in the app, because a copy change should not
 * need a migration.
 */
export type NotificationKind =
  | 'kpi_rejected' | 'kpi_approved'
  | 'month_returned' | 'month_scored'
  | 'approvals' | 'scoring' | 'records_manager'
  | 'records_hr' | 'leavers'
  | 'score_query' | 'score_query_answered'

export interface NotificationRow {
  kind: NotificationKind
  /** How many things of this kind — 1 for the ones that are singular. */
  n: number
  /** The newest of them. What "unread" is measured against. */
  latest: string
  unread: boolean
}

/**
 * A team member questioning how a month was scored.
 *
 * One per month, raised inside a window that opens when the manager
 * first scores and closes seven days later. See raise_score_query().
 */
export type ScoreQueryStatus = 'open' | 'answered'

/** Whether the point needs explaining or is being disputed. */
export type ScoreQueryKind = 'clarification' | 'disagreement'

export interface ScoreQuery {
  id: string
  submission_id: string
  employee_id: string
  manager_id: string | null
  raised_at: string
  /** Frozen when raised — changing the setting cannot move it. */
  window_closes_at: string
  status: ScoreQueryStatus
  employee_note: string | null
  /** The manager's total at the moment it was raised. */
  mgr_total_at_raise: number | null
  answered_at: string | null
  answered_by: string | null
  manager_response: string | null
  /** Computed from the snapshot, not claimed by the manager. */
  score_changed: boolean
  evidence_purged_at: string | null
  created_at: string
}

export interface ScoreQueryPoint {
  id: string
  query_id: string
  item_id: string
  kind: ScoreQueryKind
  note: string | null
  /**
   * The named parts of the row this is about — the individual core
   * values, for the core-values row. Null when the row has no parts, or
   * when none were singled out.
   */
  sub_items: string[] | null
  /** Null once the window has closed and the file has been purged. */
  evidence_path: string | null
  /** Kept after the purge, so the record still says what was attached. */
  evidence_name: string | null
}

/** Whether the button should be there, and if not, why not. */
export interface ScoreQueryState {
  can_raise: boolean
  reason: string | null
  closes_at: string | null
  days_left: number | null
  window_days: number
  existing_id: string | null
  existing_status: ScoreQueryStatus | null
}

/** One row per manager per month — see v_manager_month_status. */
export interface ManagerMonthStatusRow {
  financial_year: string
  period_month: string
  manager_id: string
  manager_ecode: string
  manager_name: string
  department: string | null
  team_size: number
  not_submitted: number
  awaiting_manager: number
  returned: number
  scored: number
  team_avg_score: number | null
}

export interface OrgKpiStatusRow {
  employee_id: string
  ecode: string
  full_name: string
  designation: string | null
  department: string | null
  location: string | null
  reporting_manager_id: string | null
  manager_ecode: string | null
  manager_name: string | null
  financial_year: string | null
  kpi_status: AssignmentStatus | 'not_set_up'
  approved_at: string | null
  months_scored: number
  months_awaiting_manager: number
  avg_score: number | null
}

export interface ManagerCompletionRow {
  manager_id: string
  manager_ecode: string
  manager_name: string
  department: string | null
  team_size: number
  kpi_approved: number
  kpi_awaiting_approval: number
  kpi_not_set_up: number
  months_awaiting_score: number | null
  team_avg_score: number | null
}

export interface ManagerTatRow {
  manager_id: string | null
  manager_ecode: string | null
  manager_name: string | null
  financial_year: string
  months_handled: number
  avg_days_to_score: number | null
  avg_days_to_finalize: number | null
  still_awaiting_score: number
  oldest_pending_days: number | null
}

export interface KraAttainmentRow {
  employee_id: string
  financial_year: string
  period_month: string
  status: SubmissionStatus
  section: Section
  kra: string
  weightage: number
  score: number | null
  attainment_pct: number | null
  band: string | null
}

/**
 * How you compare on one KRA, against people with the same KPI.
 *
 * An average and a headcount, never a name and never one person's
 * score — see my_kra_benchmark(). Nothing is returned at all unless at
 * least two other people are in the group.
 */
export interface KraBenchmarkRow {
  kra: string
  section: Section
  my_avg: number | null
  peer_avg: number | null
  /** People, not readings. */
  peers: number
  my_months: number
}

export interface WeakAreaRow {
  employee_id: string
  financial_year: string
  section: Section
  kra: string
  months: number
  avg_attainment_pct: number | null
  band: string | null
}

export interface TeamStatusRow {
  employee_id: string
  ecode: string
  full_name: string
  designation: string | null
  reporting_manager_id: string | null
  job_role: string | null
  assignment_id: string | null
  kpi_status: AssignmentStatus | null
  financial_year: string | null
  submission_id: string | null
  period_month: string | null
  submission_status: SubmissionStatus | null
  self_total_score: number | null
  mgr_total_score: number | null
  final_total_score: number | null
}
