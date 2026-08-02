import type { ScoringRule, RuleParams } from '@/lib/scoring'

export type Section = 'job_role' | 'core_values'

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
  location: string | null
  job_role_id: string | null
  reporting_manager_id: string | null
  date_of_joining: string | null
  is_active: boolean
  auth_user_id: string | null
  must_change_password: boolean
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
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  rejection_reason: string | null
}

export interface KpiAssignmentItem extends KpiRowDefinition {
  id: string
  assignment_id: string
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
  self_core_score: number | null
  self_total_score: number | null
  mgr_job_role_score: number | null
  mgr_core_score: number | null
  mgr_total_score: number | null
  final_job_role_score: number | null
  final_core_score: number | null
  final_total_score: number | null
}

export interface KpiSubmissionItem extends KpiRowDefinition {
  id: string
  submission_id: string
  assignment_item_id: string | null
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
  tm_tat: number | null
  rm_tat: number | null
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
