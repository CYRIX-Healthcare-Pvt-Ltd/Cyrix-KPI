import { useEffect, useState } from 'react'
import { X, KeyRound, Trash2, Save, UserCheck, UserX } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, Spinner } from '@/components/ui'

/**
 * Correcting or removing one employee record.
 *
 * HR could add somebody and then never touch the row again — a typo in a
 * name, a wrong manager, or a test record like E9999 stayed exactly as
 * typed. The row policy has always allowed HR to write; nothing on the
 * screen ever did.
 *
 * The login button is here rather than on the add form because it is the
 * thing most likely to be missing on a record that already exists: Add
 * employee never created one, so everybody added through the screen
 * before now has an employee record and no account.
 */
interface Row {
  ecode: string
  full_name: string
  designation: string | null
  department: string | null
  location: string | null
  is_active: boolean
  auth_user_id: string | null
  reporting_manager_id: string | null
}

export default function EditEmployee({
  ecode, onClose, onSaved,
}: {
  ecode: string
  onClose: () => void
  onSaved: () => void
}) {
  const [row, setRow] = useState<Row | null>(null)
  const [managerCode, setManagerCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Escape closes, like every other dialog here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('employees')
        .select('ecode, full_name, designation, department, location, is_active, auth_user_id, reporting_manager_id')
        .eq('ecode', ecode).maybeSingle()
      if (!alive) return
      if (err) { setError(friendlyError(err)); return }
      setRow(data as Row)
      if (data?.reporting_manager_id) {
        const { data: mgr } = await supabase
          .from('employees').select('ecode')
          .eq('id', data.reporting_manager_id).maybeSingle()
        if (alive && mgr) setManagerCode(mgr.ecode)
      }
    })()
    return () => { alive = false }
  }, [ecode])

  const set = <K extends keyof Row>(k: K) => (v: Row[K]) =>
    setRow(r => (r ? { ...r, [k]: v } : r))

  const save = async () => {
    if (!row) return
    setBusy(true); setError(null); setNotice(null)
    try {
      /*
        The manager is typed as a code and stored as an id. Looked up
        rather than trusted: a code that matches nobody would otherwise
        be saved as "no manager", which reads on every screen as a person
        at the top of the company.
      */
      let managerId: string | null = null
      const wanted = managerCode.trim().toUpperCase()
      if (wanted) {
        const { data: mgr } = await supabase
          .from('employees').select('id').eq('ecode', wanted).maybeSingle()
        if (!mgr) throw new Error(`No employee with code ${wanted}`)
        managerId = mgr.id
      }

      const { error: err } = await supabase.from('employees').update({
        full_name: row.full_name.trim(),
        designation: row.designation?.trim() || null,
        department: row.department?.trim() || null,
        location: row.location?.trim() || null,
        is_active: row.is_active,
        reporting_manager_id: managerId,
      }).eq('ecode', row.ecode)
      if (err) throw new Error(friendlyError(err))

      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const createLogin = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const { data, error: err } = await supabase.rpc('hr_create_login', { p_ecode: ecode })
      if (err) throw new Error(friendlyError(err))
      const said = data as { ok: boolean; detail?: string; email?: string }
      if (!said.ok) throw new Error(said.detail ?? 'Could not create a login.')
      setNotice(
        `Login created. They sign in as ${ecode} with ${ecode} as the password, ` +
        'and should change it.',
      )
      setRow(r => (r ? { ...r, auth_user_id: 'made' } : r))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a login.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true); setError(null)
    try {
      const { data, error: err } = await supabase.rpc('hr_delete_employee', { p_ecode: ecode })
      if (err) throw new Error(friendlyError(err))
      const said = data as { ok: boolean; detail?: string }
      if (!said.ok) throw new Error(said.detail ?? 'Could not remove that record.')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that record.')
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-shade/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${ecode}`}
    >
      <div
        className="animate-pop-in max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink-900">Edit employee</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              {ecode} — the code itself is changed from Change codes, so their
              history follows them.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon shrink-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
        {notice && <div className="mt-3"><Alert kind="success">{notice}</Alert></div>}

        {!row ? (
          <p className="py-8 text-center text-sm text-ink-500">Loading…</p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <Field label="Full name" value={row.full_name} onChange={set('full_name')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Designation" value={row.designation ?? ''} onChange={set('designation')} />
                <Field label="Department" value={row.department ?? ''} onChange={set('department')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Location" value={row.location ?? ''} onChange={set('location')} />
                <Field
                  label="Manager's employee code"
                  value={managerCode}
                  onChange={v => setManagerCode(v.toUpperCase())}
                  placeholder="E551"
                />
              </div>

              {/* Active is a switch rather than a field, because it is the
                  one thing here that changes what somebody can do rather
                  than what a screen says about them. */}
              <button
                onClick={() => set('is_active')(!row.is_active)}
                className={`flex w-full items-center gap-2.5 rounded-xl border p-3 text-left ${
                  row.is_active
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-ink-200 bg-ink-50'
                }`}
              >
                {row.is_active
                  ? <UserCheck className="h-4 w-4 shrink-0 text-emerald-700" />
                  : <UserX className="h-4 w-4 shrink-0 text-ink-400" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900">
                    {row.is_active ? 'Active' : 'Not active'}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {row.is_active
                      ? 'They can sign in and appear on their manager\'s team.'
                      : 'They cannot sign in and are off every list.'}
                  </span>
                </span>
              </button>
            </div>

            {/* The gap that made this dialog necessary. Add employee never
                created an account, so the person could not sign in and the
                sign-in screen could only say the password was wrong. */}
            {!row.auth_user_id && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  This person has no login
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  They cannot sign in at all, and the sign-in screen can only tell
                  them the password is wrong.
                </p>
                <button onClick={createLogin} disabled={busy} className="btn-secondary mt-2">
                  {busy ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                  Create their login
                </button>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={save} disabled={busy || !row.full_name.trim()} className="btn-primary">
                {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                Save changes
              </button>
              <button onClick={onClose} className="btn-secondary">Cancel</button>

              {/* Deliberately last and apart. The function refuses anybody
                  with a KPI, a submission or reports, and says which —
                  those are deactivated, not deleted. */}
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="btn-secondary ml-auto !text-cyrixRed-700"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>

            {confirmDelete && (
              <div className="mt-3 rounded-xl border border-cyrixRed-200 bg-cyrixRed-50 p-3">
                <p className="text-sm font-medium text-cyrixRed-900">
                  Delete {row.full_name} for good?
                </p>
                <p className="mt-0.5 text-xs text-cyrixRed-800">
                  Their login goes with them. This is refused if they have a KPI,
                  any assessment, or anybody reporting to them.
                </p>
                <div className="mt-2 flex gap-2">
                  <button onClick={remove} disabled={busy} className="btn-danger">
                    {busy && <Spinner className="h-4 w-4" />} Yes, delete
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="btn-secondary">
                    Keep
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        className="input mt-1"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}
