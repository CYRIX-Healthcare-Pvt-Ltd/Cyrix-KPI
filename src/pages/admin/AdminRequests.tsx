import { useState } from 'react'
import { UserMinus, Check, X, Inbox } from 'lucide-react'
import { useRemovalRequests, useRemovalAction } from '@/lib/queries'
import { PageLoader, Alert, Spinner, EmptyState } from '@/components/ui'

/**
 * Managers flag leavers; HR actions them. Approving deactivates the
 * employee rather than deleting them — appraisal history has to survive —
 * and clears the reporting line of anyone who reported to them, so HR
 * reassigns those people deliberately instead of silently inheriting.
 */
export default function AdminRequests() {
  const { data, isLoading } = useRemovalRequests()
  const action = useRemovalAction()
  const [note, setNote] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <PageLoader />

  const pending = (data ?? []).filter(r => r.request.status === 'pending')
  const history = (data ?? []).filter(r => r.request.status !== 'pending')

  const run = async (requestId: string, approve: boolean) => {
    setError(null)
    try {
      await action.mutateAsync({
        action: 'review', requestId, approve, note: note[requestId] ?? null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not action that request.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Removal requests</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {pending.length} awaiting your decision
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {pending.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing waiting">
          When a manager flags someone who has left, the request appears here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {pending.map(({ request, employee, requester }) => {
            /*
              Already gone.

              Two managers flagging the same leaver is the ordinary way
              this happens: HR actions the first request, the person is
              deactivated, and the second one sits here still offering to
              deactivate somebody who already is. Pressing it worked and
              said nothing, because the update is a no-op against a row
              that is already false.

              Said before the press rather than after it. "You have just
              done a thing that was already done" is a worse sentence
              than not offering it in the first place — the request still
              wants closing, so the button stays and only tells the truth
              about what it will do.

              An employee the query could not resolve is NOT this: that
              card already says "Unknown employee", and treating a
              missing row as a deactivated one would put the wrong
              sentence under it.
            */
            const gone = !!employee && !employee.is_active
            return (
            <div key={request.id} className="card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="rounded-lg bg-cyrixRed-50 p-2 text-cyrixRed-700">
                  <UserMinus className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">
                    {employee?.full_name ?? 'Unknown employee'}
                    <span className="ml-2 text-sm font-normal text-ink-500">
                      {employee?.ecode}
                    </span>
                    {/* At the name, because that is where the eye lands
                        before it reaches the buttons underneath. */}
                    {gone && (
                      <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                        Already deactivated
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Requested by {requester?.full_name ?? '—'} ({requester?.ecode}) on{' '}
                    {new Date(request.created_at).toLocaleDateString('en-GB')}
                    {request.last_working_day && (
                      <> · last working day {new Date(request.last_working_day).toLocaleDateString('en-GB')}</>
                    )}
                  </p>
                  <p className="mt-2 rounded-lg bg-ink-50 p-2.5 text-sm italic text-ink-700">
                    “{request.reason}”
                  </p>
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
                    disabled={action.isPending}
                    className={gone ? 'btn-secondary' : 'btn-danger'}
                  >
                    {action.isPending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    {gone ? 'Close this request' : 'Approve and deactivate'}
                  </button>
                  <button
                    onClick={() => run(request.id, false)}
                    disabled={action.isPending}
                    className="btn-secondary"
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                </div>
                <p className="text-xs text-ink-400">
                  {gone
                    ? 'Already deactivated — their login is gone and their KPI history is kept. '
                      + 'Closing marks this request done; nothing else changes.'
                    : 'Approving deactivates the account and removes their login access. Their KPI '
                      + 'history is kept. Anyone reporting to them will need a new manager.'}
                </p>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {history.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">Previously actioned</h3>
          </div>
          <div className="divide-y divide-ink-100">
            {history.slice(0, 25).map(({ request, employee }) => (
              <div key={request.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`badge ${
                  request.status === 'approved'
                    ? 'bg-ink-100 text-ink-600'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {request.status === 'approved' ? 'Removed' : 'Rejected'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-800">
                    {employee?.full_name} <span className="text-ink-400">{employee?.ecode}</span>
                  </p>
                  {request.review_note && (
                    <p className="truncate text-xs text-ink-500">{request.review_note}</p>
                  )}
                </div>
                <span className="text-xs text-ink-400">
                  {request.reviewed_at &&
                    new Date(request.reviewed_at).toLocaleDateString('en-GB')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
