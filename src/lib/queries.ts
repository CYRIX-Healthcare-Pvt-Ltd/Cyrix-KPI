import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, friendlyError } from './supabase'
import { fyForDate } from './fy'
import type {
  Employee, KpiAssignment, KpiAssignmentItem, KpiSubmission, KpiSubmissionItem,
  CoreValueDefinition, CoreValueRating, KpiTemplate, KpiTemplateItem,
  ScoringRuleMeta, AnnualSummary, JobRole, KpiRowDefinition,
  OrgKpiStatusRow, ManagerCompletionRow, ManagerTatRow, KraAttainmentRow,
  WeakAreaRow, TmRemovalRequest, DeletionRequest, RevisionRequest, RecordRequest,
  ManagerMonthStatusRow, KpiReportRow, NotificationRow, KpiRanking,
  ScoreQuery, ScoreQueryPoint, ScoreQueryState, ScoreQueryKind,
  KraBenchmarkRow,
} from '@/types/db'

/** Unwraps a PostgREST result, turning its error into a readable message. */
async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(friendlyError(error))
  return data as T
}

/**
 * Everything downstream of a submission changing state.
 *
 * Scoring a month moves a number that is read in six other places — the
 * nav badge, the team grid, the analysis pages, the year average. Listing
 * them here rather than at each call site is why the badge kept showing
 * work that was already done.
 */
const SUBMISSION_DEPENDENTS = [
  'submission', 'submission_by_id', 'team', 'team_submissions', 'history',
  'pending_counts', 'annual', 'kra_attainment', 'weak_areas',
  'org_kpi_status', 'manager_completion', 'manager_tat', 'notifications',
]

function invalidateSubmissionViews(qc: ReturnType<typeof useQueryClient>) {
  for (const key of SUBMISSION_DEPENDENTS) {
    qc.invalidateQueries({ queryKey: [key] })
  }
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
      /** Alternates ride along on the row — see migration 0040. */
      rows: Array<KpiRowDefinition & { alternates?: unknown[] }>
      sourceTemplateId?: string | null
      existingAssignmentId?: string | null
      /** Does this person carry the ESMS obligation? */
      esms: boolean
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

      // Core values and ESMS are identical for everyone who has them, so
      // the system owns those rows rather than the team member. Stamped
      // on here so a saved draft is already complete.
      //
      // One call for both, because they are one decision: ESMS takes its
      // 5% out of the core values block, and set_esms restamps core
      // values at whatever it is left with. Setting them separately is
      // how you get an assignment totalling 105%.
      const { error: stdError } = await supabase.rpc('set_esms', {
        p_assignment_id: assignmentId,
        p_enabled: args.esms,
      })
      if (stdError) throw new Error(friendlyError(stdError))

      return assignmentId
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignment'] }),
  })
}

/**
 * Manager tweaks to a KPI awaiting their approval. RLS already permits a
 * manager to edit their report's rows while the assignment is pending, so
 * small corrections don't need a full send-back-and-resubmit round trip.
 */
export function useEditAssignmentItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      itemId: string
      patch: Partial<Pick<KpiAssignmentItem,
        'kra' | 'kpi_description' | 'weightage' | 'target_value'
        // rule_params carries the % a penalty row takes off the total,
        // which is as much the manager's to correct as the target is —
        // and more consequential, since it comes off the whole score.
        | 'scoring_rule' | 'rule_params' | 'alternates'>>
    }) => {
      const { error } = await supabase
        .from('kpi_assignment_items').update(args.patch).eq('id', args.itemId)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval_items'] })
      qc.invalidateQueries({ queryKey: ['assignment'] })
    },
  })
}

/** This month's target only — the annual KPI baseline is untouched. */
export function useSaveMonthlyTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { itemId: string; target: number | null }) => {
      const { error } = await supabase
        .from('kpi_submission_items')
        .update({ target_value: args.target })
        .eq('id', args.itemId)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission_by_id'] })
    },
  })
}

/**
 * Switches one month's row to one of its alternatives, or back.
 *
 * An RPC because the guard freezes the KRA and the scoring rule for the
 * year — correctly, since those are the agreed contract. This is not a
 * new definition, it is a choice between definitions already approved,
 * and the server is where that difference can actually be checked.
 */
export function useUseAlternate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { itemId: string; alternateId: string | null }) => {
      const { error } = await supabase.rpc('use_alternate', {
        p_item_id: args.itemId,
        p_alternate_id: args.alternateId,
      })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['submission_by_id'] })
    },
  })
}

/**
 * Which month this KPI starts from.
 *
 * An RPC rather than a column update because the rules do not match the
 * rest of the row: the KPI's contents freeze on approval, but this stays
 * settable afterwards — every KPI in the system predates the column, and
 * those answers have to be collected from people whose KPI is already
 * active. The server checks it never moves past a month already assessed.
 */
export function useSetKpiStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { assignmentId: string; month: string }) => {
      const { error } = await supabase.rpc('set_kpi_start', {
        p_assignment_id: args.assignmentId,
        p_starts_from: args.month,
      })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignment'] })
      qc.invalidateQueries({ queryKey: ['approval_items'] })
      qc.invalidateQueries({ queryKey: ['pending_approvals'] })
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['manager_month_status'] })
    },
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
      qc.invalidateQueries({ queryKey: ['pending_counts'] })
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['org_kpi_status'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
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
      // Only required when the manager is scoring materially below the
      // self assessment — the server decides that, and refuses if it is
      // needed and missing.
      if (args.action === 'submit_manager') params.p_reason = args.reason ?? null

      const { error } = await supabase.rpc(fn, params)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => invalidateSubmissionViews(qc),
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

/**
 * Where you stand on each KRA against people doing the same job.
 *
 * Server-side because it has to be: a team member can read their own
 * scores and nobody else's, so no query this client could make would
 * produce a peer average. The RPC returns an average and a count.
 */
export function useKraBenchmark(employeeId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeId,
    queryKey: ['kra_benchmark', employeeId, fy],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_kra_benchmark', {
        p_employee_id: employeeId,
        p_financial_year: fy,
      })
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as KraBenchmarkRow[]
    },
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

/**
 * Which bands each person carries this year.
 *
 * Read off the KPI rather than inferred from the scores, so a column for
 * ESMS appears because somebody is measured on it, not because somebody
 * has finally been scored on it.
 */
export function useTeamAssignments(employeeIds: string[] | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeIds?.length,
    queryKey: ['team_assignments', employeeIds, fy],
    queryFn: async () => {
      const assignments = await unwrap<KpiAssignment[]>(
        supabase.from('kpi_assignments').select('*')
          .in('employee_id', employeeIds!).eq('financial_year', fy)
          .in('status', ['draft', 'pending_approval', 'active', 'rejected']),
      )
      if (assignments.length === 0) {
        return { assignments, items: [] as KpiAssignmentItem[] }
      }
      // The rows themselves, because "who has the same KPI" has to be
      // answered from the KPI. Answering it from the scores puts two
      // people with identical KPIs in different groups the moment one of
      // them has been scored on fewer rows than the other.
      const items = await unwrap<KpiAssignmentItem[]>(
        supabase.from('kpi_assignment_items').select('*')
          .in('assignment_id', assignments.map(a => a.id)),
      )
      return { assignments, items }
    },
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
      //
      // The .order() is what makes paging safe. Each request is a separate
      // query, and without an ORDER BY the planner is free to return rows
      // in a different order each time — so a row could land in both pages
      // or in neither. That is exactly what happened: one employee
      // appeared twice in the list and the approved-KPI count read 4 when
      // three exist.
      const all: OrgKpiStatusRow[] = []
      for (let from = 0; ; from += 1000) {
        const page = await unwrap<OrgKpiStatusRow[]>(
          supabase.from('v_org_kpi_status').select('*')
            .order('ecode').range(from, from + 999),
        )
        all.push(...page)
        if (page.length < 1000) break
      }
      return all
    },
  })
}

// ---------------------------------------------------------------------
// The HR report
// ---------------------------------------------------------------------

/** Dimensions to slice by. Order matters — it is the column order too. */
export type ReportDim = 'function' | 'department' | 'manager'

/**
 * The one report behind what used to be three tabs.
 *
 * Aggregation happens in SQL, so changing the grouping returns tens of
 * rows rather than re-summing thousands in the browser, and the export
 * is the same rows the table is showing.
 */
export function useKpiReport(
  fy: string,
  opts: {
    month?: string | null
    fn?: string | null
    department?: string | null
    managerId?: string | null
    groupBy: ReportDim[]
    enabled?: boolean
  },
) {
  const { month, fn, department, managerId, groupBy, enabled = true } = opts
  return useQuery({
    enabled: enabled && groupBy.length > 0,
    queryKey: ['kpi_report', fy, month ?? 'ytd', fn, department, managerId, groupBy],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('kpi_report', {
        p_financial_year: fy,
        p_month: month ?? null,
        p_function: fn ?? null,
        p_department: department ?? null,
        p_manager_id: managerId ?? null,
        p_group_by: groupBy,
      })
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as KpiReportRow[]
    },
  })
}

/**
 * Every function / department / manager combination that exists, for the
 * cascading filters.
 *
 * Pulled from one month of the report rows: the view crosses employees
 * with months, so a single month is exactly one row per person — the
 * cheapest way to get all three dimensions already scoped by RLS.
 */
export function useReportFilterTree(fy: string, anyMonth: string, enabled: boolean) {
  return useQuery({
    enabled,
    staleTime: 5 * 60_000,
    queryKey: ['report_filter_tree', fy, anyMonth],
    queryFn: async () => {
      const rows: Array<{
        function_name: string; department: string
        manager_id: string; manager_ecode: string; manager_name: string
      }> = []
      for (let from = 0; ; from += 1000) {
        const page = await unwrap<typeof rows>(
          supabase.from('v_kpi_report_rows')
            .select('function_name, department, manager_id, manager_ecode, manager_name')
            .eq('financial_year', fy).eq('period_month', anyMonth)
            .order('function_name').range(from, from + 999),
        )
        rows.push(...page)
        if (page.length < 1000) break
      }
      return rows
    },
  })
}

/**
 * Month-by-month status per manager.
 *
 * One hook, two readings, because it is the same shape either way: HR
 * pins a month and reads every manager; a manager pins themselves and
 * reads every month. The view is security_invoker, so the scoping is the
 * database's job — a manager gets their own row whatever they ask for.
 */
export function useManagerMonthStatus(
  fy: string,
  opts: { month?: string; managerId?: string; enabled?: boolean } = {},
) {
  const { month, managerId, enabled = true } = opts
  return useQuery({
    enabled,
    queryKey: ['manager_month_status', fy, month ?? 'all', managerId ?? 'all'],
    queryFn: () => {
      let q = supabase.from('v_manager_month_status').select('*')
        .eq('financial_year', fy)
      if (month) q = q.eq('period_month', month)
      if (managerId) q = q.eq('manager_id', managerId)
      return unwrap<ManagerMonthStatusRow[]>(
        q.order('period_month').order('manager_name'),
      )
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
// Closing the month
// ---------------------------------------------------------------------

/**
 * Closes any month whose date has come.
 *
 * There is no scheduler here, so months settle when somebody reads a
 * screen that lists them — which is the moment it matters, and an unread
 * month that has not settled is one nobody is editing either. Global
 * rather than scoped to the caller: the rule is a date, identical for
 * everyone, and settling only what the reader can see would make "is it
 * final yet" depend on who last opened the app.
 */
export function useSettleDueMonths(enabled: boolean) {
  const qc = useQueryClient()
  return useQuery({
    enabled,
    queryKey: ['settle_due'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('settle_due_submissions')
      if (error) return 0
      const n = (data as number) ?? 0
      if (n > 0) invalidateSubmissionViews(qc)
      return n
    },
  })
}

/** The company-wide closing day — a day of the following month. */
export function useMonthClose() {
  return useQuery({
    queryKey: ['month_close'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = await unwrap<Array<{ value: { closing_day?: number | null } }>>(
        supabase.from('app_settings').select('value').eq('key', 'month_close').limit(1),
      )
      // Null is a real answer here — SW Admin turning closing off —
      // so it is not coalesced to a default. Only a missing row is.
      return rows.length ? rows[0].value.closing_day ?? null : 10
    },
  })
}

export function useSetMonthClose() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (day: number | null) => {
      const { error } = await supabase.rpc('set_month_close', { p_closing_day: day })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['month_close'] })
      qc.invalidateQueries({ queryKey: ['score_query_state'] })
      qc.invalidateQueries({ queryKey: ['settle_due'] })
    },
  })
}

// ---------------------------------------------------------------------
// Profile photos
// ---------------------------------------------------------------------

/**
 * Both writes go through a definer function rather than an RLS policy on
 * employees: that table holds reporting lines and job roles, and opening
 * it to self-update so one column can be written is how somebody ends up
 * able to change who they report to.
 */
export function useSetMyAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dataUrl: string | null) => {
      const { error } = await supabase.rpc('set_my_avatar', { p_data: dataUrl })
      if (error) throw new Error(friendlyError(error))
    },
    // Every list that draws a face reads the employee row, so they all
    // go — the header, the team grid, the analysis table.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      qc.invalidateQueries({ queryKey: ['manager'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useRemoveAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { employeeId: string; reason: string }) => {
      const { error } = await supabase.rpc('remove_avatar', {
        p_employee_id: args.employeeId,
        p_reason: args.reason,
      })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })
}

// ---------------------------------------------------------------------
// Score queries — a team member questioning how a month was scored
// ---------------------------------------------------------------------

export const EVIDENCE_BUCKET = 'kpi-evidence'

/** Whether the button should be offered, straight from the rule. */
export function useScoreQueryState(submissionId: string | undefined) {
  return useQuery({
    enabled: !!submissionId,
    queryKey: ['score_query_state', submissionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('score_query_state', {
        p_submission_id: submissionId,
      })
      if (error) throw new Error(friendlyError(error))
      return ((data ?? [])[0] ?? null) as ScoreQueryState | null
    },
  })
}

export interface QueryPointInput {
  item_id: string
  kind: ScoreQueryKind
  note?: string | null
  /** Named parts of the row — the individual core values. */
  sub_items?: string[]
  /** A file the team member picked, uploaded before the query is written. */
  file?: File | null
}

/**
 * Raises the query, evidence first.
 *
 * The files go up before the row exists, because a query that references
 * an upload which then failed is worse than an upload with no query —
 * the second is a stray object the purge will never find, and the first
 * is a broken link in an argument about somebody's appraisal. Anything
 * already uploaded is removed if a later one fails.
 */
export function useRaiseScoreQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      submissionId: string
      note?: string | null
      points: QueryPointInput[]
    }) => {
      const uploaded: string[] = []
      try {
        const payload = []
        for (const p of args.points) {
          let path: string | null = null
          if (p.file) {
            // Scoped by submission: the storage policy reads the first
            // folder segment to decide whose month this is.
            const safe = p.file.name.replace(/[^\w.\- ]+/g, '_').slice(-80)
            path = `${args.submissionId}/${p.item_id}/${Date.now()}-${safe}`
            const { error } = await supabase.storage
              .from(EVIDENCE_BUCKET).upload(path, p.file, { upsert: false })
            if (error) throw new Error(friendlyError(error))
            uploaded.push(path)
          }
          payload.push({
            item_id: p.item_id,
            kind: p.kind,
            note: p.note ?? null,
            sub_items: p.sub_items ?? [],
            evidence_path: path,
            evidence_name: p.file?.name ?? null,
          })
        }

        const { error } = await supabase.rpc('raise_score_query', {
          p_submission_id: args.submissionId,
          p_note: args.note ?? null,
          p_points: payload,
        })
        if (error) throw new Error(friendlyError(error))
      } catch (err) {
        if (uploaded.length) {
          await supabase.storage.from(EVIDENCE_BUCKET).remove(uploaded)
        }
        throw err
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['score_query_state'] })
      qc.invalidateQueries({ queryKey: ['score_queries'] })
      qc.invalidateQueries({ queryKey: ['open_query_months'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export interface ScoreQueryRow {
  query: ScoreQuery
  points: ScoreQueryPoint[]
  employee: Employee | undefined
  submission: KpiSubmission | undefined
  items: KpiSubmissionItem[]
}

/**
 * Every query the signed-in person is allowed to see, newest first.
 *
 * One hook for both readings — a manager gets their team's, HR gets the
 * lot — because RLS decides that, not the caller. HR's screen is
 * read-only by role, not by asking a different question.
 */
export function useScoreQueries(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['score_queries'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<ScoreQueryRow[]> => {
      const queries = await unwrap<ScoreQuery[]>(
        supabase.from('kpi_score_queries').select('*')
          .order('raised_at', { ascending: false }),
      )
      if (queries.length === 0) return []

      const ids = queries.map(q => q.id)
      const subIds = [...new Set(queries.map(q => q.submission_id))]
      const empIds = [...new Set(queries.map(q => q.employee_id))]

      const [points, people, submissions, items] = await Promise.all([
        unwrap<ScoreQueryPoint[]>(
          supabase.from('kpi_score_query_points').select('*').in('query_id', ids),
        ),
        unwrap<Employee[]>(
          supabase.from('employees').select('*').in('id', empIds),
        ),
        unwrap<KpiSubmission[]>(
          supabase.from('kpi_submissions').select('*').in('id', subIds),
        ),
        unwrap<KpiSubmissionItem[]>(
          supabase.from('kpi_submission_items').select('*')
            .in('submission_id', subIds).order('sort_order'),
        ),
      ])

      const byPerson = new Map(people.map(p => [p.id, p]))
      const bySub = new Map(submissions.map(s => [s.id, s]))
      return queries.map(query => ({
        query,
        points: points.filter(p => p.query_id === query.id),
        employee: byPerson.get(query.employee_id),
        submission: bySub.get(query.submission_id),
        items: items.filter(i => i.submission_id === query.submission_id),
      }))
    },
  })
}

/**
 * The nav badge. Counted in SQL, and scoped by RLS rather than by this
 * query — a manager's own policy is what limits it to their team.
 */
export function useOpenScoreQueries(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['open_score_queries'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('kpi_score_queries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
      if (error) throw new Error(friendlyError(error))
      return count ?? 0
    },
  })
}

/**
 * The months that have a question hanging over them.
 *
 * Just the ids, so every list that draws a status badge can say "Under
 * review" without fetching the queries themselves. Scoped by RLS: a team
 * member gets their own, a manager gets their team's.
 */
export function useOpenQueryMonths(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['open_query_months'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const rows = await unwrap<Array<{ submission_id: string }>>(
        supabase.from('kpi_score_queries').select('submission_id').eq('status', 'open'),
      )
      return new Set(rows.map(r => r.submission_id))
    },
  })
}

export function useAnswerScoreQuery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { queryId: string; response: string }) => {
      const { error } = await supabase.rpc('answer_score_query', {
        p_query_id: args.queryId,
        p_response: args.response,
      })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['score_queries'] })
      qc.invalidateQueries({ queryKey: ['score_query_state'] })
      qc.invalidateQueries({ queryKey: ['open_query_months'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      invalidateSubmissionViews(qc)
    },
  })
}

/** A short-lived link to one attachment. Private bucket, so never a URL. */
export async function evidenceUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET).createSignedUrl(path, 120)
  if (error) throw new Error(friendlyError(error))
  return data.signedUrl
}

/**
 * Deletes evidence whose window has closed on a query already answered.
 *
 * Two steps on purpose: removing the row from storage.objects would
 * leave the file itself behind, so the Storage API does the deleting and
 * the database is only told afterwards. Run when a manager or HR opens
 * the queries screen — there is no scheduler in this system, and tying
 * it to the screen that lists them means it runs about as often as
 * anybody looks.
 */
export async function purgeExpiredEvidence(): Promise<number> {
  const { data, error } = await supabase.rpc('expired_query_evidence')
  if (error) return 0
  const rows = (data ?? []) as Array<{ query_id: string; path: string }>
  if (rows.length === 0) return 0

  const { error: rmError } = await supabase.storage
    .from(EVIDENCE_BUCKET).remove(rows.map(r => r.path))
  if (rmError) return 0

  await supabase.rpc('mark_query_evidence_purged', {
    p_query_ids: [...new Set(rows.map(r => r.query_id))],
  })
  return rows.length
}

// ---------------------------------------------------------------------
// Turnaround policy
// ---------------------------------------------------------------------

export interface TatPolicy {
  /** Days a team member gets after the month ends before it counts. */
  tm_grace_days: number
  /** Days a manager gets, from the same month boundary. */
  manager_grace_days: number
  /** First month turnaround is measured at all. Null = every month. */
  starts_from: string | null
}

export const TAT_POLICY_FALLBACK: TatPolicy = {
  tm_grace_days: 3, manager_grace_days: 5, starts_from: null,
}

/**
 * Readable by everyone — it is the allowance they are being held to, and
 * a deadline nobody can look up is not a deadline. Writing it goes
 * through an RPC, because app_settings is HR's by RLS and this is SW
 * Admin's to set.
 */
export function useTatPolicy() {
  return useQuery({
    queryKey: ['tat_policy'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = await unwrap<Array<{ value: TatPolicy }>>(
        supabase.from('app_settings').select('value').eq('key', 'tat_policy').limit(1),
      )
      return { ...TAT_POLICY_FALLBACK, ...(rows[0]?.value ?? {}) } as TatPolicy
    },
  })
}

export function useSaveTatPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: TatPolicy) => {
      const { error } = await supabase.rpc('set_tat_policy', {
        p_tm_grace: p.tm_grace_days,
        p_manager_grace: p.manager_grace_days,
        p_starts_from: p.starts_from,
      })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tat_policy'] })
      // Every turnaround figure on every screen is measured against it.
      qc.invalidateQueries({ queryKey: ['kpi_report'] })
      qc.invalidateQueries({ queryKey: ['kpi_ranking'] })
    },
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
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// ---------------------------------------------------------------------
// Record requests — deleting a wrongly submitted month, and revising a
// KPI that has already been approved and locked. Different subjects, the
// same two-stage governance, so they share a screen and a badge.
// ---------------------------------------------------------------------

/** Both queues, with the people attached, newest first. */
export function useRecordRequests() {
  return useQuery({
    queryKey: ['record_requests'],
    queryFn: async () => {
      const [deletions, revisions] = await Promise.all([
        unwrap<DeletionRequest[]>(
          supabase.from('record_deletion_requests').select('*')
            .order('created_at', { ascending: false }),
        ),
        unwrap<RevisionRequest[]>(
          supabase.from('kpi_revision_requests').select('*')
            .order('created_at', { ascending: false }),
        ),
      ])

      const rows: RecordRequest[] = [
        ...deletions.map(r => ({ kind: 'deletion' as const, ...r })),
        ...revisions.map(r => ({ kind: 'revision' as const, ...r })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at))

      if (rows.length === 0) return []

      const ids = [...new Set(rows.flatMap(r => [r.employee_id, r.requested_by]))]
      const people = await unwrap<Employee[]>(
        supabase.from('employees').select('*').in('id', ids),
      )
      const byId = new Map(people.map(p => [p.id, p]))
      return rows.map(request => ({
        request,
        employee: byId.get(request.employee_id),
        requester: byId.get(request.requested_by),
      }))
    },
  })
}

/**
 * The nav badge. Counted in SQL rather than by filtering the list above,
 * so the number is the same one the server would enforce — a client-side
 * filter over rows RLS happened to return is a different question.
 */
export function usePendingRecordRequests(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['pending_record_requests'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_pending_record_requests')
      if (error) throw new Error(friendlyError(error))
      return (data as number) ?? 0
    },
  })
}

/** Is there already an open request against this month or this KPI? */
export function useOpenRequestFor(
  kind: 'deletion' | 'revision',
  id: string | undefined,
) {
  return useQuery({
    enabled: !!id,
    queryKey: ['open_request', kind, id],
    queryFn: async () => {
      const table = kind === 'deletion'
        ? 'record_deletion_requests' : 'kpi_revision_requests'
      const column = kind === 'deletion' ? 'submission_id' : 'assignment_id'
      const rows = await unwrap<Array<{ status: string }>>(
        supabase.from(table).select('status')
          .eq(column, id!).in('status', ['pending_manager', 'pending_hr']).limit(1),
      )
      return rows[0] ?? null
    },
  })
}

export function useRequestAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      kind: 'deletion' | 'revision'
      action: 'request' | 'review'
      /** submission_id for a deletion, assignment_id for a revision. */
      subjectId?: string
      reason?: string
      requestId?: string
      approve?: boolean
      note?: string
    }) => {
      const fn = args.action === 'request'
        ? (args.kind === 'deletion' ? 'request_record_deletion' : 'request_kpi_revision')
        : (args.kind === 'deletion' ? 'review_record_deletion' : 'review_kpi_revision')

      const params: Record<string, unknown> = args.action === 'request'
        ? args.kind === 'deletion'
          ? { p_submission_id: args.subjectId, p_reason: args.reason ?? '' }
          : { p_assignment_id: args.subjectId, p_reason: args.reason ?? '' }
        : {
            p_request_id: args.requestId,
            p_approve: args.approve ?? false,
            p_note: args.note ?? null,
          }

      const { error } = await supabase.rpc(fn, params)
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['record_requests'] })
      qc.invalidateQueries({ queryKey: ['pending_record_requests'] })
      qc.invalidateQueries({ queryKey: ['open_request'] })
      qc.invalidateQueries({ queryKey: ['assignment'] })
      invalidateSubmissionViews(qc)
    },
  })
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------

/**
 * Everything waiting on the signed-in person, in one round trip.
 *
 * Derived server-side from live state rather than read from an event
 * log, so a notification cannot outlive its cause: approve the KPI and
 * the row stops being returned. Which is also why nothing here is
 * dismissible — the way to clear it is to do it.
 */
export function useNotifications(employeeId: string | undefined, enabled: boolean) {
  return useQuery({
    enabled: enabled && !!employeeId,
    // Keyed by person, like every other per-employee query here. The RPC
    // scopes itself to the caller, so this is not what keeps one person's
    // notifications away from another — it is what stops the cache from
    // handing the previous sign-in's rows to the next one on a shared
    // phone, in the moment before the refetch lands.
    queryKey: ['notifications', employeeId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_notifications')
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as NotificationRow[]
    },
  })
}

/**
 * Clears one informational notification.
 *
 * Only the news kinds — the server refuses anything that represents
 * outstanding work, because a queue you can dismiss is a queue that gets
 * forgotten.
 */
export function useDismissNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (kind: string) => {
      const { error } = await supabase.rpc('dismiss_notification', { p_kind: kind })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/** Opening the panel is reading it: stamps every kind currently listed. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_notifications_read')
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------

/**
 * Where this person stands for the year.
 *
 * The whole calculation is server-side because it has to be: a team
 * member can read their own submissions and nobody else's, so no query
 * this client could make would rank them against the company. The RPC
 * returns a position and a denominator, never another person's score.
 */
export function useKpiRanking(employeeId: string | undefined, fy: string) {
  return useQuery({
    enabled: !!employeeId,
    queryKey: ['kpi_ranking', employeeId, fy],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('kpi_ranking', {
        p_employee_id: employeeId,
        p_financial_year: fy,
      })
      if (error) throw new Error(friendlyError(error))
      return ((data ?? [])[0] ?? null) as KpiRanking | null
    },
  })
}

/** The one person above you in the tree. RLS already allows reading them. */
export function useMyManager(managerId: string | null | undefined) {
  return useQuery({
    enabled: !!managerId,
    staleTime: 5 * 60_000,
    queryKey: ['manager', managerId],
    queryFn: async () => {
      const rows = await unwrap<Employee[]>(
        supabase.from('employees').select('*').eq('id', managerId!).limit(1),
      )
      return rows[0] ?? null
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
