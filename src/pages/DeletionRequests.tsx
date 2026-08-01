import { useState } from 'react'
import { Trash2, Check, X, Inbox, ArrowRight, PencilRuler } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useRecordRequests, useRequestAction } from '@/lib/queries'
import { monthLabel } from '@/lib/fy'
import { PageLoader, Alert, Spinner, EmptyState } from '@/components/ui'
import type { RecordRequest } from '@/types/db'

const STAGE_LABEL: Record<string, string> = {
  pending_manager: 'With the reporting manager',
  pending_hr: 'With HR',
  approved: 'Done',
  rejected: 'Rejected',
}

const STAGE_STYLE: Record<string, string> = {
  pending_manager: 'bg-amber-100 text-amber-800',
  pending_hr: 'bg-ink-900 text-white',
  approved: 'bg-cyrixRed-100 text-cyrixRed-800',
  rejected: 'bg-ink-100 text-ink-600',
}

/** What each kind of request is actually about, in the reader's terms. */
const KIND = {
  deletion: {
    icon: Trash2,
    noun: 'Delete a month',
    approve: 'Approve and pass to HR',
    finalApprove: 'Approve and delete permanently',
    outcome: 'The month and its scores are removed.',
  },
  revision: {
    icon: PencilRuler,
    noun: 'Revise a KPI',
    approve: 'Approve and pass to HR',
    finalApprove: 'Approve and unlock the KPI',
    outcome:
      'The KPI reopens for editing. Months already assessed keep the ' +
      'definition and the scores they were given.',
  },
} as const

const subjectOf = (r: RecordRequest) =>
  r.kind === 'deletion' ? monthLabel(r.period_month) : `FY ${r.financial_year} KPI`

/**
 * Two things can be asked of a record that is otherwise locked: remove a
 * month that was submitted by mistake, and reopen a KPI whose owner has
 * changed job role. Both need the reporting manager and then HR — the
 * manager knows whether it is genuine, HR owns the appraisal record.
 */
export default function DeletionRequests() {
  const { employee, isManager, isHrAdmin } = useAuth()
  const [note, setNote] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useRecordRequests()
  const review = useRequestAction()

  if (isLoading) return <PageLoader />

  const all = data ?? []
  const actionable = all.filter(({ request }) => {
    if (request.status === 'pending_manager') return isManager || isHrAdmin
    if (request.status === 'pending_hr') return isHrAdmin
    return false
  })
  const mine = all.filter(r => r.request.requested_by === employee?.id)
  const history = all.filter(r => ['approved', 'rejected'].includes(r.request.status))

  const run = async (request: RecordRequest, approve: boolean) => {
    setError(null)
    try {
      await review.mutateAsync({
        kind: request.kind,
        action: 'review',
        requestId: request.id,
        approve,
        note: note[request.id],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not action that request.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Record requests</h1>
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
        <span className="badge bg-cyrixRed-100 text-cyrixRed-800">Done</span>
        <span className="ml-2">
          Both stages must approve. Nothing changes until HR has decided.
        </span>
      </div>

      {actionable.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing waiting for you">
          Requests to remove a wrongly submitted month, or to reopen a KPI after
          a role change, appear here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {actionable.map(({ request, employee: tm, requester }) => {
            const kind = KIND[request.kind]
            const Icon = kind.icon
            const isFinal = request.status === 'pending_hr'
            return (
              <div key={request.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="rounded-lg bg-cyrixRed-50 p-2 text-cyrixRed-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-ink-100 text-ink-700">{kind.noun}</span>
                      <p className="font-medium text-ink-900">
                        {tm?.full_name} — {subjectOf(request)}
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
                    {isFinal && (
                      <p className="mt-2 text-xs text-ink-500">{kind.outcome}</p>
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
                      onClick={() => run(request, true)}
                      disabled={review.isPending}
                      className={
                        isFinal && request.kind === 'deletion' ? 'btn-danger' : 'btn-primary'
                      }
                    >
                      {review.isPending
                        ? <Spinner className="h-4 w-4" />
                        : <Check className="h-4 w-4" />}
                      {isFinal ? kind.finalApprove : kind.approve}
                    </button>
                    <button
                      onClick={() => run(request, false)}
                      disabled={review.isPending}
                      className="btn-secondary"
                    >
                      <X className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {mine.length > 0 && (
        <RequestList title="Requests I raised" rows={mine} />
      )}
      {history.length > 0 && (
        <RequestList title="Decided" rows={history.slice(0, 20)} showDate />
      )}
    </div>
  )
}

function RequestList({
  title, rows, showDate,
}: {
  title: string
  rows: Array<{ request: RecordRequest; employee?: { full_name: string } }>
  showDate?: boolean
}) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      </div>
      <div className="divide-y divide-ink-100">
        {rows.map(({ request, employee: tm }) => (
          <div key={request.id} className="flex items-center gap-3 px-4 py-3">
            <span className={`badge ${STAGE_STYLE[request.status]}`}>
              {STAGE_LABEL[request.status]}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm text-ink-800">
              {KIND[request.kind].noun} · {tm?.full_name} — {subjectOf(request)}
            </p>
            {showDate && (
              <span className="text-xs text-ink-400">
                {request.hr_decided_at &&
                  new Date(request.hr_decided_at).toLocaleDateString('en-GB')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
