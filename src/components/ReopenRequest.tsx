import { useState } from 'react'
import { LockOpen, Clock } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { useReopenRequest, useRequestAction } from '@/lib/queries'

const STAGE: Record<string, { text: string; style: string }> = {
  pending_manager: { text: 'With the manager', style: 'bg-amber-100 text-amber-800' },
  pending_hr: { text: 'With HR', style: 'bg-amber-100 text-amber-800' },
  approved: { text: 'Opened', style: 'bg-green-100 text-green-800' },
  rejected: { text: 'Rejected', style: 'bg-ink-100 text-ink-600' },
}

/**
 * "Request to open" a month a last day closed (0273; the user, 10 Nov). Shown
 * only to whoever missed it: the team member for a month not sent in, the
 * manager for one not scored. Asked once; after that the stage takes its place.
 */
export function ReopenRequest({ submissionId, title, sendLabel }: {
  submissionId: string
  /** "Open Amal's Oct-26?" */
  title: string
  /** "Send to HR", "Send to your manager". */
  sendLabel: string
}) {
  const { data: existing, isLoading } = useReopenRequest(submissionId)
  const request = useRequestAction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [failed, setFailed] = useState('')

  if (isLoading) return null
  if (existing) {
    const s = STAGE[existing.status] ?? STAGE.pending_hr
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Clock className="h-4 w-4" />
        <span className="text-sm font-medium">Request to open</span>
        <span className={`badge ${s.style}`}>{s.text}</span>
      </div>
    )
  }

  const send = async () => {
    if (!reason.trim()) { setFailed('Write the reason'); return }
    setFailed('')
    try {
      await request.mutateAsync({ kind: 'reopen', action: 'request', subjectId: submissionId, reason: reason.trim() })
      setOpen(false)
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Could not send that.')
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary mt-3 !text-cyrixRed-700" onClick={() => { setFailed(''); setOpen(true) }}>
        <LockOpen className="h-4 w-4" /> Request to open
      </button>
      {open && (
        <Dialog title={title} icon={<LockOpen className="h-5 w-5 text-cyrixRed-600" />} onClose={() => { if (!request.isPending) setOpen(false) }}>
          <label className="label" htmlFor="reopen-reason">Reason</label>
          <textarea id="reopen-reason" className="input min-h-[6rem]" value={reason}
            onChange={e => { setReason(e.target.value); setFailed('') }} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" className="btn-secondary" disabled={request.isPending} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-danger" disabled={request.isPending} onClick={() => void send()}>
              {request.isPending ? <Spinner className="h-4 w-4" /> : null} {sendLabel}
            </button>
          </div>
          {failed && <p role="alert" className="mt-2 text-sm font-medium text-cyrixRed-700">{failed}</p>}
        </Dialog>
      )}
    </>
  )
}
