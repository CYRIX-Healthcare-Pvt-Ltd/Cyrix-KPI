/**
 * Recall the year's KPI while it waits on the manager (0251; the user, 5 Nov: "set up my kpi, there before manager
 * approves we need recall"). The same amber button and question as a month's Recall (0245): it comes back as a
 * draft to change, and leaves the manager's list until it is submitted again.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import Dialog from '@/components/Dialog'
import { Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'

export default function RecallKpi({ assignmentId, fy }: { assignmentId: string; fy: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recall = async () => {
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('kpi_assignment_recall', { p_assignment_id: assignmentId })
    setBusy(false)
    if (e) { setError(friendlyError(e)); void qc.invalidateQueries({ queryKey: ['assignment'] }); return }
    setOpen(false)
    for (const k of ['assignment', 'pending_approvals', 'pending_counts', 'team', 'org_kpi_status', 'notifications']) void qc.invalidateQueries({ queryKey: [k] })
    navigate('/my-kpi/setup')
  }
  return (
    <>
      <button type="button" className="btn-secondary mt-3 !text-amber-600" onClick={() => { setError(''); setOpen(true) }}>
        <Undo2 className="h-4 w-4" /> Recall
      </button>
      {open && (
        <Dialog title={`Recall your KPI for FY ${fy}?`} icon={<Undo2 className="h-5 w-5 text-amber-600" />} onClose={() => setOpen(false)}>
          <p className="text-sm text-ink-600">It comes back to you as a draft and leaves your manager's list until you submit it again.</p>
          {error && <p className="mt-3 text-sm text-cyrixRed-600" role="alert">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary justify-center" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary justify-center !bg-amber-500 hover:!bg-amber-600" disabled={busy} onClick={() => void recall()}>
              {busy ? <Spinner className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />} Recall
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
