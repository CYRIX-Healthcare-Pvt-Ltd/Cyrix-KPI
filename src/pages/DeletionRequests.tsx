import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Check, X, Inbox, ArrowRight } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { monthLabel } from '@/lib/fy'
import { PageLoader, Alert, Spinner, EmptyState } from '@/components/ui'
import type { Employee } from '@/types/db'

interface DeletionRequest {
  id: string
  submission_id: string
  employee_id: string
  period_month: string
  requested_by: string
  reason: string
  status: 'pending_manager' | 'pending_hr' | 'approved' | 'rejected'
  manager_note: string | null
  hr_note: string | null
  manager_decided_at: string | null
  hr_decided_at: string | null
  created_at: string
}

const STAGE_LABEL: Record<string, string> = {
  pending_manager: 'With the reporting manager',
  pending_hr: 'With HR',
  approved: 'Deleted',
  rejected: 'Rejected',
}

const STAGE_STYLE: Record<string, string> = {
  pending_manager: 'bg-amber-100 text-amber-800',
  pending_hr: 'bg-ink-900 text-white',
  approved: 'bg-cyrixRed-100 text-cyrixRed-800',
  rejected: 'bg-ink-100 text-ink-600',
}

/**
 * Deleting a submitted month needs two approvals: the reporting manager,
 * who knows whether the month is genuinely wrong, then HR, who owns the
 * appraisal record. Neither alone can erase a scored month.
 */
export default function DeletionRequests() {
  const { employee, isManager, isHrAdmin } = useAuth()
  const qc = useQueryClient()
  const [note, setNote] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['deletion_requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('record_deletion_requests').select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(friendlyError(error))
      const rows = data as DeletionRequest[]
      if (rows.length === 0) return []

      const ids = [...new Set(rows.flatMap(r => [r.employee_id, r.requested_by]))]
      const { data: people } = await supabase.from('employees').select('*').in('id', ids)
      const byId = new Map((people ?? []).map((p: Employee) => [p.id, p]))
      return rows.map(r => ({
        request: r,
        employee: byId.get(r.employee_id),
        requester: byId.get(r.requested_by),
      }))
    },
  })

  const review = useMutation({
    mutationFn: async (args: { id: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc('review_record_deletion', {
        p_request_id: args.id, p_approve: args.approve, p_note: args.note ?? null,
      })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deletion_requests'] })
      qc.invalidateQueries({ queryKey: ['submission'] })
      qc.invalidateQueries({ queryKey: ['history'] })
    },
  })

  if (isLoading) return <PageLoader />

  const all = data ?? []
  const actionable = all.filter(({ request }) => {
    if (request.status === 'pending_manager') return isManager || isHrAdmin
    if (request.status === 'pending_hr') return isHrAdmin
    return false
  })
  const mine = all.filter(r => r.request.requested_by === employee?.id)
  const history = all.filter(r => ['approved', 'rejected'].includes(r.request.status))

  const run = async (id: string, approve: boolean) => {
    setError(null)
    try {
      await review.mutateAsync({ id, approve, note: note[id] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not action that request.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Record deletions</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {actionable.length} awaiting your decision
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200/70 bg-ink-50 p-3.5 text-xs text-ink-600">
        <span className="badge bg-amber-100 text-amber-800">Reporting manager</span>
        <ArrowRight className="h-3.5 w-3.5 text-ink-300" />
        <span className="badge bg-ink-900 text-white">HR</span>
        <ArrowRight className="h-3.5 w-3.5 text-ink-300" />
        <span className="badge bg-cyrixRed-100 text-cyrixRed-800">Deleted</span>
        <span className="ml-2">
          Both stages must approve. The figures are written to the audit log before
          the row goes.
        </span>
      </div>

      {actionable.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing waiting for you">
          Requests to delete a wrongly submitted month appear here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {actionable.map(({ request, employee: tm, requester }) => (
            <div key={request.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="rounded-lg bg-cyrixRed-50 p-2 text-cyrixRed-700">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink-900">
                      {tm?.full_name} — {monthLabel(request.period_month)}
                    </p>
                    <span className={`badge ${STAGE_STYLE[request.status]}`}>
                      {STAGE_LABEL[request.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {tm?.ecode} · requested by {requester?.full_name} on{' '}
                    {new Date(request.created_at).toLocaleDateString('en-GB')}
                  </p>
                  <p className="mt-2 rounded-lg bg-ink-50 p-2.5 text-sm italic text-ink-700">
                    “{request.reason}”
                  </p>
                  {request.manager_note && (
                    <p className="mt-2 text-xs text-ink-500">
                      Manager's note: {request.manager_note}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <input
                  className="input"
                  placeholder="Note (optional)"
                  value={note[request.id] ?? ''}
                  onChange={e => setNote({ ...note, [request.id]: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => run(request.id, true)}
                    disabled={review.isPending}
                    className={request.status === 'pending_hr' ? 'btn-danger' : 'btn-primary'}
                  >
                    {review.isPending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    {request.status === 'pending_hr'
                      ? 'Approve and delete permanently'
                      : 'Approve and pass to HR'}
                  </button>
                  <button
                    onClick={() => run(request.id, false)}
                    disabled={review.isPending}
                    className="btn-secondary"
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {mine.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">Requests I raised</h3>
          </div>
          <div className="divide-y divide-ink-100">
            {mine.map(({ request, employee: tm }) => (
              <div key={request.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`badge ${STAGE_STYLE[request.status]}`}>
                  {STAGE_LABEL[request.status]}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-ink-800">
                  {tm?.full_name} — {monthLabel(request.period_month)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">Decided</h3>
          </div>
          <div className="divide-y divide-ink-100">
            {history.slice(0, 20).map(({ request, employee: tm }) => (
              <div key={request.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`badge ${STAGE_STYLE[request.status]}`}>
                  {STAGE_LABEL[request.status]}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-ink-800">
                  {tm?.full_name} — {monthLabel(request.period_month)}
                </p>
                <span className="text-xs text-ink-400">
                  {request.hr_decided_at &&
                    new Date(request.hr_decided_at).toLocaleDateString('en-GB')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
