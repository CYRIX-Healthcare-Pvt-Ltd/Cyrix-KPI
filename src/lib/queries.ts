import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendlyError } from './supabase'
import { fyForDate } from './fy'
import type {
  Employee, KpiAssignment, KpiAssignmentItem, KpiSubmission, KpiSubmissionItem,
  CoreValueDefinition, CoreValueRating, KpiTemplate, KpiTemplateItem,
  ScoringRuleMeta, AnnualSummary, JobRole, KpiRowDefinition,
  OrgKpiStatusRow, ManagerCompletionRow, ManagerTatRow, KraAttainmentRow,
  WeakAreaRow, TmRemovalRequest,
} from '@/types/db'

/** Unwraps a PostgREST result, turning its error into a readable message. */
async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(friendlyError(error))
  return data as T
}

export const currentFy = () => fyForDate(new Date())

// ---------------------------------------------------------------------
// Reference data — effectively static for a session.
// ---------------------------------------------------------------------
export function useScoringRules() {
  return useQuery({
    queryKey: ['scoring_rules'],
    staleTime: Infinity,
    queryFn: () =>
      unwrap<ScoringRuleMeta[]>(
        supabase.from('scoring_rules').select('*').order('sort_order'),
      ),
  })
}

export function useCoreValues() {
  return useQuery({
    queryKey: ['core_values'],
    staleTime: Infinity,
    queryFn: () =>
      unwrap<CoreValueDefinition[]>(
        supabase.from('core_value_definitions').select('*')
          .eq('is_active', true).order('sort_order'),
      ),
  })
}

export function useJobRoles() {
  return useQuery({
    queryKey: ['job_roles'],
    staleTime: Infinity,
    queryFn: () =>
      unwrap<JobRole[]>(
        supabase.from('job_roles').select('*').eq('is_active', true).order('name'),
      ),
  })
}

export function useTemplatesForRole(jobRoleId: string | null | undefined, fy: string) {
  return useQuery({
    enabled: !!jobRoleId,
    queryKey: ['templates', jobRoleId, fy],
    queryFn: async () => {
      const tpls = await unwrap<KpiTemplate[]>(
        supabase.from('kpi_templates').select('*')
          .eq('job_role_id', jobRoleId!).eq('financial_year', fy)
          .eq('status', 'active').order('version', { ascending: false }),
      )
      if (tpls.length === 0) return { template: null, items: [] as KpiTemplateItem[] }
      const items = await unwrap<KpiTemplateItem[]>(
        supabase.from('kpi_template_items').select('*')
          .eq('template_id', tpls[0].id).order('sort_order'),
      )
      return { template: tpls[0], items }
    },
  })
}

// ---------------------------------------------------------------------
// Assignments — a person's KPI structure for a year
// ---------------------------------------------------------------------
export function useMyAssignment(employeeId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeId,
    queryKey: ['assignment', employeeId, fy],
    queryFn: async () => {
      const rows = await unwrap<KpiAssignment[]>(
        supabase.from('kpi_assignments').select('*')
          .eq('employee_id', employeeId!).eq('financial_year', fy)
          .in('status', ['draft', 'pending_approval', 'active', 'rejected'])
          .order('created_at', { ascending: false }).limit(1),
      )
      const assignment = rows[0] ?? null
      if (!assignment) return { assignment: null, items: [] as KpiAssignmentItem[] }
      const items = await unwrap<KpiAssignmentItem[]>(
        supabase.from('kpi_assignment_items').select('*')
          .eq('assignment_id', assignment.id).order('sort_order'),
      )
      return { assignment, items }
    },
  })
}

/** Replaces an assignment's rows wholesale — used by the Excel import. */
export function useSaveAssignmentRows() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      employeeId: string
      fy: string
      rows: KpiRowDefinition[]
      sourceTemplateId?: string | null
      existingAssignmentId?: string | null
    }) => {
      let assignmentId = args.existingAssignmentId ?? null

      if (!assignmentId) {
        const created = await unwrap<KpiAssignment[]>(
          supabase.from('kpi_assignments').insert({
            employee_id: args.employeeId,
            financial_year: args.fy,
            source_template_id: args.sourceTemplateId ?? null,
            status: 'draft',
          }).select(),
        )
        assignmentId = created[0].id
      }

      // Full replace keeps the saved grid identical to what was reviewed.
      const del = await supabase.from('kpi_assignment_items')
        .delete().eq('assignment_id', assignmentId)
      if (del.error) throw new Error(friendlyError(del.error))

      const ins = await supabase.from('kpi_assignment_items').insert(
        args.rows.map(r => ({ ...r, assignment_id: assignmentId })),
      )
      if (ins.error) throw new Error(friendlyError(ins.error))

      // Core values are identical for everyone, so the system owns that row
      // rather than the team member. Stamped on here so a saved draft is
      // already complete, and again server-side on submit.
      const { error: cvError } = await supabase.rpc('apply_standard_core_values', {
        p_assignment_id: assignmentId,
      })
      if (cvError) throw new Error(friendlyError(cvError))

      return assignmentId
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignment'] }),
  })
}

export function useAssignmentAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      action: 'submit' | 'approve' | 'reject'
      assignmentId: string
      reason?: string
    }) => {
      const fn = {
        submit: 'submit_assignment_for_approval',
        approve: 'approve_assignment',
        reject: 'reject_assignment',
      }[args.action]

      const params: Record<string, unknown> = { p_assignment_id: args.assignmentId }
      if (args.action === 'reject') params.p_reason = args.reason ?? ''

      const { error } = await supabase.rpc(fn, params)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignment'] })
      qc.invalidateQueries({ queryKey: ['pending_approvals'] })
      qc.invalidateQueries({ queryKey: ['team'] })
    },
  })
}

// ---------------------------------------------------------------------
// Submissions — one month of assessment
// ---------------------------------------------------------------------
export function useSubmission(employeeId: string | undefined, month: string) {
  return useQuery({
    enabled: !!employeeId && !!month,
    queryKey: ['submission', employeeId, month],
    queryFn: async () => {
      const subs = await unwrap<KpiSubmission[]>(
        supabase.from('kpi_submissions').select('*')
          .eq('employee_id', employeeId!).eq('period_month', month).limit(1),
      )
      const submission = subs[0] ?? null
      if (!submission) {
        return { submission: null, items: [] as KpiSubmissionItem[], ratings: [] as CoreValueRating[] }
      }
      const [items, ratings] = await Promise.all([
        unwrap<KpiSubmissionItem[]>(
          supabase.from('kpi_submission_items').select('*')
            .eq('submission_id', submission.id).order('sort_order'),
        ),
        unwrap<CoreValueRating[]>(
          supabase.from('core_value_ratings').select('*')
            .eq('submission_id', submission.id),
        ),
      ])
      return { submission, items, ratings }
    },
  })
}

export function useSubmissionById(submissionId: string | undefined) {
  return useQuery({
    enabled: !!submissionId,
    queryKey: ['submission_by_id', submissionId],
    queryFn: async () => {
      const submission = await unwrap<KpiSubmission>(
        supabase.from('kpi_submissions').select('*').eq('id', submissionId!).single(),
      )
      const [items, ratings, employee] = await Promise.all([
        unwrap<KpiSubmissionItem[]>(
          supabase.from('kpi_submission_items').select('*')
            .eq('submission_id', submissionId!).order('sort_order'),
        ),
        unwrap<CoreValueRating[]>(
          supabase.from('core_value_ratings').select('*').eq('submission_id', submissionId!),
        ),
        unwrap<Employee>(
          supabase.from('employees').select('*').eq('id', submission.employee_id).single(),
        ),
      ])
      return { submission, items, ratings, employee }
    },
  })
}

export function useOpenSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { employeeId: string; month: string }) => {
      const { data, error } = await supabase.rpc('open_submission', {
        p_employee_id: args.employeeId,
        p_period_month: args.month,
      })
      if (error) throw new Error(friendlyError(error))
      return data as KpiSubmission
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submission'] }),
  })
}

/** Saves achieved values. Scores are recomputed by the DB trigger. */
export function useSaveItemValues() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      role: 'self' | 'manager'
      updates: Array<{ id: string; achieved: number | null; remarks?: string | null }>
    }) => {
      const field = args.role === 'self' ? 'self_achieved' : 'manager_achieved'
      const remarksField = args.role === 'self' ? 'self_remarks' : 'manager_remarks'

      for (const u of args.updates) {
        const patch: Record<string, unknown> = { [field]: u.achieved }
        if (u.remarks !== undefined) patch[remarksField] = u.remarks
        const { error } = await supabase
          .from('kpi_submission_items').update(patch).eq('id', u.id)
        if (error) throw new Error(friendlyError(error))
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission_by_id'] })
    },
  })
}

export function useSaveCoreRatings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      role: 'self' | 'manager'
      updates: Array<{ id: string; rating: string | null }>
    }) => {
      const field = args.role === 'self' ? 'self_rating' : 'manager_rating'
      for (const u of args.updates) {
        const { error } = await supabase
          .from('core_value_ratings').update({ [field]: u.rating }).eq('id', u.id)
        if (error) throw new Error(friendlyError(error))
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission_by_id'] })
    },
  })
}

export function useSubmissionAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      action: 'submit_self' | 'submit_manager' | 'return' | 'finalize'
      submissionId: string
      reason?: string
    }) => {
      const fn = {
        submit_self: 'submit_self_assessment',
        submit_manager: 'submit_manager_scores',
        return: 'return_submission',
        finalize: 'finalize_submission',
      }[args.action]

      const params: Record<string, unknown> = { p_submission_id: args.submissionId }
      if (args.action === 'return') params.p_reason = args.reason ?? ''

      const { error } = await supabase.rpc(fn, params)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission_by_id'] })
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['history'] })
    },
  })
}

// ---------------------------------------------------------------------
// Team / manager views
// ---------------------------------------------------------------------
export function useMyTeam(managerId: string | undefined) {
  return useQuery({
    enabled: !!managerId,
    queryKey: ['team', managerId],
    queryFn: () =>
      unwrap<Employee[]>(
        supabase.from('employees').select('*')
          .eq('reporting_manager_id', managerId!).eq('is_active', true)
          .order('full_name'),
      ),
  })
}

/** Everything a manager needs for the team grid, in two round trips. */
export function useTeamMonth(managerId: string | undefined, month: string, fy: string) {
  return useQuery({
    enabled: !!managerId,
    queryKey: ['team', 'month', managerId, month, fy],
    queryFn: async () => {
      const team = await unwrap<Employee[]>(
        supabase.from('employees').select('*')
          .eq('reporting_manager_id', managerId!).eq('is_active', true)
          .order('full_name'),
      )
      if (team.length === 0) return { team, submissions: [], assignments: [] }

      const ids = team.map(t => t.id)
      const [submissions, assignments] = await Promise.all([
        unwrap<KpiSubmission[]>(
          supabase.from('kpi_submissions').select('*')
            .in('employee_id', ids).eq('period_month', month),
        ),
        unwrap<KpiAssignment[]>(
          supabase.from('kpi_assignments').select('*')
            .in('employee_id', ids).eq('financial_year', fy)
            .in('status', ['draft', 'pending_approval', 'active', 'rejected']),
        ),
      ])
      return { team, submissions, assignments }
    },
  })
}

export function usePendingApprovals(managerId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!managerId,
    queryKey: ['pending_approvals', managerId, fy],
    queryFn: async () => {
      const team = await unwrap<Employee[]>(
        supabase.from('employees').select('*')
          .eq('reporting_manager_id', managerId!).eq('is_active', true),
      )
      if (team.length === 0) return []
      const assignments = await unwrap<KpiAssignment[]>(
        supabase.from('kpi_assignments').select('*')
          .in('employee_id', team.map(t => t.id))
          .eq('financial_year', fy).eq('status', 'pending_approval'),
      )
      const byId = new Map(team.map(t => [t.id, t]))
      return assignments.map(a => ({ assignment: a, employee: byId.get(a.employee_id)! }))
    },
  })
}

// ---------------------------------------------------------------------
// History / annual
// ---------------------------------------------------------------------
export function useSubmissionHistory(employeeId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeId,
    queryKey: ['history', employeeId, fy],
    queryFn: () =>
      unwrap<KpiSubmission[]>(
        supabase.from('kpi_submissions').select('*')
          .eq('employee_id', employeeId!).eq('financial_year', fy)
          .order('period_month'),
      ),
  })
}

/**
 * Counts for the nav badges: KPIs awaiting approval and months awaiting
 * scoring. One round trip each, head-only, so it is cheap to poll.
 */
export function usePendingCounts(managerId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!managerId,
    queryKey: ['pending_counts', managerId, fy],
    refetchInterval: 60_000,
    queryFn: async () => {
      const team = await unwrap<Array<{ id: string }>>(
        supabase.from('employees').select('id')
          .eq('reporting_manager_id', managerId!).eq('is_active', true),
      )
      if (team.length === 0) return { approvals: 0, scoring: 0 }
      const ids = team.map(t => t.id)

      const [{ count: approvals }, { count: scoring }] = await Promise.all([
        supabase.from('kpi_assignments')
          .select('id', { count: 'exact', head: true })
          .in('employee_id', ids).eq('financial_year', fy).eq('status', 'pending_approval'),
        supabase.from('kpi_submissions')
          .select('id', { count: 'exact', head: true })
          .in('employee_id', ids).eq('status', 'submitted'),
      ])
      return { approvals: approvals ?? 0, scoring: scoring ?? 0 }
    },
  })
}

// ---------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------

/** Per-KRA attainment for a set of people, used for weak-area analysis. */
export function useKraAttainment(employeeIds: string[] | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeIds?.length,
    queryKey: ['kra_attainment', employeeIds, fy],
    queryFn: () =>
      unwrap<KraAttainmentRow[]>(
        supabase.from('v_kra_attainment').select('*')
          .in('employee_id', employeeIds!).eq('financial_year', fy)
          .order('period_month'),
      ),
  })
}

export function useWeakAreas(employeeIds: string[] | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeIds?.length,
    queryKey: ['weak_areas', employeeIds, fy],
    queryFn: () =>
      unwrap<WeakAreaRow[]>(
        supabase.from('v_employee_weak_areas').select('*')
          .in('employee_id', employeeIds!).eq('financial_year', fy),
      ),
  })
}

/** Every month for a set of people — the basis for exports and trends. */
export function useTeamSubmissions(employeeIds: string[] | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeIds?.length,
    queryKey: ['team_submissions', employeeIds, fy],
    queryFn: () =>
      unwrap<KpiSubmission[]>(
        supabase.from('kpi_submissions').select('*')
          .in('employee_id', employeeIds!).eq('financial_year', fy)
          .order('period_month'),
      ),
  })
}

// ---------------------------------------------------------------------
// HR admin
// ---------------------------------------------------------------------
export function useOrgKpiStatus(enabled: boolean, fy: string) {
  return useQuery({
    enabled,
    queryKey: ['org_kpi_status', fy],
    queryFn: async () => {
      // 1,100+ active employees, so page through rather than truncate at
      // PostgREST's default limit and quietly under-report.
      const all: OrgKpiStatusRow[] = []
      for (let from = 0; ; from += 1000) {
        const page = await unwrap<OrgKpiStatusRow[]>(
          supabase.from('v_org_kpi_status').select('*').range(from, from + 999),
        )
        all.push(...page)
        if (page.length < 1000) break
      }
      return all
    },
  })
}

export function useManagerCompletion(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['manager_completion'],
    queryFn: () =>
      unwrap<ManagerCompletionRow[]>(
        supabase.from('v_manager_completion').select('*')
          .order('team_size', { ascending: false }),
      ),
  })
}

export function useManagerTat(enabled: boolean, fy: string) {
  return useQuery({
    enabled,
    queryKey: ['manager_tat', fy],
    queryFn: () =>
      unwrap<ManagerTatRow[]>(
        supabase.from('v_manager_tat').select('*').eq('financial_year', fy),
      ),
  })
}

// ---------------------------------------------------------------------
// Removal requests
// ---------------------------------------------------------------------
export function useRemovalRequests(status?: 'pending') {
  return useQuery({
    queryKey: ['removal_requests', status],
    queryFn: async () => {
      let q = supabase.from('tm_removal_requests').select('*')
        .order('created_at', { ascending: false })
      if (status) q = q.eq('status', status)
      const rows = await unwrap<TmRemovalRequest[]>(q)
      if (rows.length === 0) return []

      const ids = [...new Set(rows.flatMap(r => [r.employee_id, r.requested_by]))]
      const people = await unwrap<Employee[]>(
        supabase.from('employees').select('*').in('id', ids),
      )
      const byId = new Map(people.map(p => [p.id, p]))
      return rows.map(r => ({
        request: r,
        employee: byId.get(r.employee_id),
        requester: byId.get(r.requested_by),
      }))
    },
  })
}

export function useRemovalAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      action: 'request' | 'review'
      employeeId?: string
      reason?: string
      lastWorkingDay?: string | null
      requestId?: string
      approve?: boolean
      note?: string
    }) => {
      if (args.action === 'request') {
        const { error } = await supabase.rpc('request_tm_removal', {
          p_employee_id: args.employeeId,
          p_reason: args.reason ?? '',
          p_last_working_day: args.lastWorkingDay ?? null,
        })
        if (error) throw new Error(friendlyError(error))
      } else {
        const { error } = await supabase.rpc('review_tm_removal', {
          p_request_id: args.requestId,
          p_approve: args.approve ?? false,
          p_note: args.note ?? null,
        })
        if (error) throw new Error(friendlyError(error))
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['removal_requests'] })
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['org_kpi_status'] })
    },
  })
}

export function useAnnualSummary(employeeId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeId,
    queryKey: ['annual', employeeId, fy],
    queryFn: async () => {
      const rows = await unwrap<AnnualSummary[]>(
        supabase.from('v_annual_summary').select('*')
          .eq('employee_id', employeeId!).eq('financial_year', fy),
      )
      return rows[0] ?? null
    },
  })
}
