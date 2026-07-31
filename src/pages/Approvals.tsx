import { useState, Fragment } from 'react'
import { CheckSquare, Check, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePendingApprovals, useAssignmentAction, currentFy } from '@/lib/queries'
import { supabase, friendlyError } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { Alert, PageLoader, Spinner, EmptyState } from '@/components/ui'
import type { KpiAssignmentItem, Section } from '@/types/db'

export default function Approvals() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { data, isLoading } = usePendingApprovals(employee?.id, fy)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading) return <PageLoader />

  if (!data || data.length === 0) {
    return (
      <EmptyState icon={CheckSquare} title="Nothing waiting for approval">
        When someone on your team submits their KPI for FY {fy}, it will appear here.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">KPI approvals</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {data.length} waiting · FY {fy}
        </p>
      </div>

      <div className="space-y-3">
        {data.map(({ assignment, employee: tm }) => (
          <ApprovalCard
            key={assignment.id}
            assignmentId={assignment.id}
            name={tm.full_name}
            ecode={tm.ecode}
            designation={tm.designation}
            expanded={expanded === assignment.id}
            onToggle={() =>
              setExpanded(expanded === assignment.id ? null : assignment.id)
            }
          />
        ))}
      </div>
    </div>
  )
}

function ApprovalCard({
  assignmentId, name, ecode, designation, expanded, onToggle,
}: {
  assignmentId: string
  name: string
  ecode: string
  designation: string | null
  expanded: boolean
  onToggle: () => void
}) {
  const action = useAssignmentAction()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: items } = useQuery({
    enabled: expanded,
    queryKey: ['approval_items', assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_assignment_items').select('*')
        .eq('assignment_id', assignmentId).order('sort_order')
      if (error) throw new Error(friendlyError(error))
      return data as KpiAssignmentItem[]
    },
  })

  const run = async (act: 'approve' | 'reject') => {
    setError(null)
    try {
      await action.mutateAsync({
        action: act, assignmentId, reason: act === 'reject' ? reason : undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete that.')
    }
  }

  const total = (s: Section) =>
    (items ?? []).filter(i => i.section === s).reduce((a, b) => a + b.weightage, 0)

  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-ink-50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-200 text-xs font-semibold text-ink-700">
          {name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">{name}</p>
          <p className="truncate text-xs text-ink-500">
            {ecode}{designation && ` · ${designation}`}
          </p>
        </div>
        <span className="text-xs font-medium text-ink-900">
          {expanded ? 'Hide' : 'Review'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-ink-100">
          {!items ? (
            <div className="p-6 text-center"><Spinner className="mx-auto h-5 w-5 text-ink-400" /></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                      <th className="px-4 py-2 font-medium">KRA</th>
                      <th className="px-4 py-2 font-medium">KPI</th>
                      <th className="px-4 py-2 text-right font-medium">Wt</th>
                      <th className="px-4 py-2 text-right font-medium">Target</th>
                      <th className="px-4 py-2 font-medium">Scoring</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {(['job_role', 'core_values'] as Section[]).map(section => (
                      <Fragment key={section}>
                        <tr className="bg-ink-50/60">
                          <td colSpan={5} className="px-4 py-1.5 text-xs font-semibold text-ink-600">
                            {section === 'job_role' ? 'Job Role — 80%' : 'Core Values — 20%'}
                            <span className={`ml-2 font-normal ${
                              total(section) === (section === 'job_role' ? 80 : 20)
                                ? 'text-emerald-700' : 'text-red-700'
                            }`}>
                              (total {total(section)}%)
                            </span>
                          </td>
                        </tr>
                        {items.filter(i => i.section === section).map(item => (
                          <tr key={item.id}>
                            <td className="px-4 py-2.5 font-medium text-ink-900">{item.kra}</td>
                            <td className="max-w-md px-4 py-2.5 text-xs text-ink-500">
                              {item.kpi_description}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{item.weightage}%</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {item.target_value ?? '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-ink-500">
                              {item.scoring_rule.replace(/_/g, ' ')}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 border-t border-ink-100 p-4">
                {error && <Alert kind="error">{error}</Alert>}

                {!rejecting ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => run('approve')}
                      disabled={action.isPending}
                      className="btn-primary"
                    >
                      {action.isPending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      Approve
                    </button>
                    <button onClick={() => setRejecting(true)} className="btn-secondary">
                      <X className="h-4 w-4" /> Send back
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="label" htmlFor={`r-${assignmentId}`}>
                      What needs changing?
                    </label>
                    <textarea
                      id={`r-${assignmentId}`}
                      rows={2}
                      className="input"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Response time should be weighted 30%, not 25%"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => run('reject')}
                        disabled={!reason.trim() || action.isPending}
                        className="btn-danger"
                      >
                        Send back to {name.split(' ')[0]}
                      </button>
                      <button onClick={() => setRejecting(false)} className="btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
