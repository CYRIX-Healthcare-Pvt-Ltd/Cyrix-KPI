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
