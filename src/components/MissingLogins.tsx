import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, X } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { createMissingLogins, useMissingLogins, type LoginRun } from '@/lib/logins'

/**
 * Everybody who cannot sign in yet, and one button that lets them all in.
 *
 * On HR's Employees page and on the software administrator's Logins tab.
 * A login used to be made one person at a time from their record, and a
 * bulk import that should have made them made none (3 Oct) — the user:
 * "if 100 user is there, i need to do each manually". Nothing shows when
 * everybody active has a login.
 */
export default function MissingLogins() {
  const qc = useQueryClient()
  const { data } = useMissingLogins()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [run, setRun] = useState<LoginRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const todo = (data ?? []).filter(m => !m.unlinked)
  const stuck = (data ?? []).filter(m => m.unlinked)

  const create = async () => {
    setBusy(true); setError(null); setProgress(0)
    try {
      setRun(await createMissingLogins(setProgress))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logins could not be created just now.')
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: ['missing_logins'] })
      qc.invalidateQueries({ queryKey: ['org_kpi_status'] })
      qc.invalidateQueries({ queryKey: ['login_status'] })
    }
  }

  if (run) {
    return (
      <div className="relative">
        <Alert kind={run.created.length ? 'success' : 'warning'} title={`${run.created.length} login${run.created.length === 1 ? '' : 's'} created`}>
          {run.created.length > 0 && (
            <p>
              {run.created.join(', ')}. Each signs in with their employee code as both the user and the password, and should change it.
            </p>
          )}
          {run.failed.length > 0 && <p className="mt-2">Could not be created: {run.failed.join('; ')}</p>}
          {run.unlinked.length > 0 && (
            <p className="mt-2">
              Not made: {run.unlinked.join(', ')} — an account with their address already exists but is not linked to their record.
            </p>
          )}
        </Alert>
        <button type="button" onClick={() => setRun(null)} aria-label="Close" className="btn-icon absolute right-1.5 top-1.5">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (!todo.length && !stuck.length) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {todo.length > 0
              ? `${todo.length} ${todo.length === 1 ? 'person has' : 'people have'} no login yet`
              : 'Logins that cannot be made here'}
          </p>
          {todo.length > 0 && (
            <p className="mt-0.5 text-xs text-amber-800">
              They cannot sign in until they have one. Each gets their employee code as both the user and the first password.
            </p>
          )}
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {todo.slice(0, 12).map(m => (
              <li key={m.ecode} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-700">
                {m.ecode} · {m.full_name}
              </li>
            ))}
            {todo.length > 12 && (
              <li className="rounded-full px-2 py-0.5 text-[11px] font-medium text-amber-800">and {todo.length - 12} more</li>
            )}
          </ul>
          {stuck.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              {stuck.map(m => m.ecode).join(', ')}: an account with their address already exists but is not linked to their record, so it cannot be made here.
            </p>
          )}
        </div>
        {todo.length > 0 && (
          <button type="button" onClick={create} disabled={busy} className="btn-primary shrink-0">
            {busy ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            {busy && progress > 0 ? `${progress} of ${todo.length} made…` : todo.length === 1 ? 'Create their login' : 'Create their logins'}
          </button>
        )}
      </div>
      {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
    </div>
  )
}
