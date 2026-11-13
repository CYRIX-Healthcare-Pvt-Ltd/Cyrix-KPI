/**
 * Software Admin → Admins (the user, 2 Nov: "sw admin will set admins, example HR admin : salman, issac,
 * IT admin : adrain, sreemon", "i need option to set salman both kpi n digest and issac only digest").
 *
 * A person, a desk, and the modules ticked for it (0246); the desk role follows from the ticks. The shared
 * desk logins are not here: they keep their own roles.
 */
import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import Dialog from '@/components/Dialog'
import MultiPick from '@/components/MultiPick'
import { EmptyState, SortHeader, Spinner } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'

type Desk = 'hr' | 'it' | 'mkt' | 'mgmt' | 'acc' | 'travel'

/** Each desk and the modules it can administer, as desk_modules() has them. */
const DESKS: Record<Desk, { label: string; modules: string[] }> = {
  hr: { label: 'HR', modules: ['KPI', 'Digest'] },
  it: { label: 'IT', modules: ['Logins', 'Support', 'Digest'] },
  mkt: { label: 'Marketing', modules: ['Digest'] },
  /** Leaders posting to Cyrix Digest under "Management" (0249; the user, 5 Nov). */
  mgmt: { label: 'Management', modules: ['Digest'] },
  acc: { label: 'Accounts', modules: ['Travel Expense'] },
  travel: { label: 'Travel Desk', modules: ['Travel Expense'] },
}

interface Row {
  employee_id: string; ecode: string; full_name: string; desk: Desk; modules: string[]
  set_by: string | null; set_at: string
}
const KEY = ['desk_admins']

type SortKey = 'name' | 'desk' | 'on'

export default function AdminsTab() {
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('desk_admin_list')
      if (error) throw new Error(friendlyError(error))
      return data as Row[]
    },
  })
  const [q, setQ] = useState('')
  const needle = useDeferredValue(q.trim().toLowerCase())
  const [deskFilter, setDeskFilter] = useState<Desk | ''>('')
  const [sortKey, setSortKey] = useState<SortKey | null>('name')
  const [asc, setAsc] = useState(true)
  const onSort = (k: SortKey) => { if (k === sortKey) setAsc(a => !a); else { setSortKey(k); setAsc(true) } }
  const [editing, setEditing] = useState<Row | 'new' | null>(null)

  const shown = useMemo(() => {
    const list = rows.filter(r => (!deskFilter || r.desk === deskFilter)
      && (!needle || r.full_name.toLowerCase().includes(needle) || r.ecode.toLowerCase().includes(needle)))
    if (!sortKey) return list
    const val = (r: Row) => (sortKey === 'desk' ? DESKS[r.desk].label : sortKey === 'on' ? r.set_at : r.full_name)
    return [...list].sort((a, b) => val(a).localeCompare(val(b)) * (asc ? 1 : -1))
  }, [rows, needle, deskFilter, sortKey, asc])

  if (isLoading) return <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
  if (error) return <p className="text-sm text-cyrixRed-600">{(error as Error).message}</p>

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2">
          <h3 className="flex items-center gap-2 px-1 text-sm font-semibold text-ink-800">
            <ShieldCheck className="h-4 w-4 text-ink-400" /> Admins
          </h3>
          <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
            <select className="input !w-auto !py-1.5" value={deskFilter} onChange={e => setDeskFilter(e.target.value as Desk | '')} aria-label="Desk">
              <option value="">All desks</option>
              {(Object.keys(DESKS) as Desk[]).map(d => <option key={d} value={d}>{DESKS[d].label}</option>)}
            </select>
            <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input className="input !py-1.5 !pl-8" placeholder="Name or code" value={q} onChange={e => setQ(e.target.value)} />
            </label>
            <button type="button" className="btn-primary !py-1.5" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> Add admin
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ShieldCheck} title={q || deskFilter ? 'Nobody matches that' : 'No admins set yet'} />
          </div>
        ) : (<>
          {/* Phone: each admin its own box — name and pencil, desk and date, then the modules (the user, 13 Nov). */}
          <ul className="space-y-2 p-3 sm:hidden">
            {shown.map(r => (
              <li key={r.employee_id + r.desk} className="rounded-xl border border-ink-200 p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{r.full_name} ({r.ecode})</p>
                  <button type="button" className="btn-icon -m-1.5 shrink-0" aria-label={`Change ${r.full_name}`} onClick={() => setEditing(r)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-ink-500">
                  {DESKS[r.desk].label} · {new Date(r.set_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.modules.map(m => <span key={m} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">{m}</span>)}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <SortHeader label="Name" col="name" sortKey={sortKey} asc={asc} onSort={onSort} />
                  <SortHeader label="Desk" col="desk" sortKey={sortKey} asc={asc} onSort={onSort} />
                  <th className="px-4 py-2.5 font-medium">Modules</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Set by</th>
                  <SortHeader label="Date" col="on" sortKey={sortKey} asc={asc} onSort={onSort} />
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {shown.map(r => (
                  <tr key={r.employee_id + r.desk} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{r.full_name} ({r.ecode})</p>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{DESKS[r.desk].label}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.modules.map(m => <span key={m} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">{m}</span>)}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-ink-500 sm:table-cell">{r.set_by ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {new Date(r.set_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" className="btn-icon" aria-label={`Change ${r.full_name}`} onClick={() => setEditing(r)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </div>

      {editing && <AdminDialog row={editing === 'new' ? null : editing} taken={rows} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AdminDialog({ row, taken, onClose }: { row: Row | null; taken: Row[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [person, setPerson] = useState<string[]>(row ? [row.employee_id] : [])
  const [desk, setDesk] = useState<Desk | ''>(row?.desk ?? '')
  const [modules, setModules] = useState<string[]>(row?.modules ?? [])
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // On a change every desk can be chosen (the user, 3 Nov: "on edit, why cant i click other modules?"): one the person
  // already holds opens with its ticks and can be removed; another is added beside it on Save.
  const holds = (d: Desk) => taken.some(t => t.employee_id === person[0] && t.desk === d)
  const held = desk && holds(desk) ? desk : null

  // People only: the shared desk logins keep their own roles. Paged past the 1,000-row cap.
  const { data: people = [] } = useQuery({
    queryKey: ['desk_admin_people'],
    enabled: !row,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const all: Array<{ id: string; ecode: string; full_name: string }> = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('employees').select('id, ecode, full_name')
          .eq('is_active', true).neq('account_type', 'admin').order('full_name').range(from, from + 999)
        if (error) throw error
        all.push(...data)
        if (data.length < 1000) break
      }
      return all
    },
  })

  // A desk the person already holds opens with its ticks; a new one with all of them.
  const pickDesk = (d: Desk) => {
    setDesk(d)
    const had = taken.find(t => t.employee_id === person[0] && t.desk === d)
    setModules(had?.modules ?? DESKS[d].modules)
  }

  const save = async () => {
    if (!person[0] || !desk || !modules.length) { setError('Choose the person, the desk and at least one module'); return }
    setBusy(true); setError('')
    const { error } = await supabase.rpc('desk_admin_set', { p_employee_id: person[0], p_desk: desk, p_modules: modules })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    void qc.invalidateQueries({ queryKey: KEY })
    onClose()
  }
  const remove = async () => {
    if (!row) return
    setBusy(true); setError('')
    if (!held) return
    const { error } = await supabase.rpc('desk_admin_remove', { p_employee_id: row.employee_id, p_desk: held })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    void qc.invalidateQueries({ queryKey: KEY })
    onClose()
  }

  return (
    <Dialog title={row ? `Change ${row.full_name}` : 'Add admin'} icon={<ShieldCheck className="h-5 w-5 text-ink-500" />} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="label">Person <span className="text-cyrixRed-600">*</span></span>
          {row
            ? <p className="mt-1 text-sm font-medium text-ink-900">{row.full_name} ({row.ecode})</p>
            : <div className="mt-1">
                <MultiPick id="desk-admin-person" value={person} onChange={v => setPerson(v.slice(-1))} placeholder="Name or E-code"
                  options={people.map(p => ({ value: p.id, label: p.full_name, hint: p.ecode }))} />
              </div>}
        </div>
        <div>
          <span className="label">Desk <span className="text-cyrixRed-600">*</span></span>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(DESKS) as Desk[]).map(d => (
              <button key={d} type="button" onClick={() => pickDesk(d)} aria-pressed={desk === d}
                className={clsx('justify-center', desk === d ? 'btn-primary' : 'btn-secondary')}>
                {DESKS[d].label}{row && holds(d) && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500" aria-label="holds this desk" />}
              </button>
            ))}
          </div>
        </div>
        {desk && (
          <div>
            <span className="label">Modules <span className="text-cyrixRed-600">*</span></span>
            <div className="mt-1 space-y-1">
              {DESKS[desk].modules.map(m => (
                <label key={m} className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-cyrixRed-600" checked={modules.includes(m)}
                    onChange={e => setModules(v => (e.target.checked ? [...v, m] : v.filter(x => x !== m)))} />
                  <span className="text-sm text-ink-800">{m}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-cyrixRed-600" role="alert">{error}</p>}
        {confirmRemove && row && held ? (
          <div className="rounded-lg border border-cyrixRed-200 bg-cyrixRed-50 p-3">
            <p className="text-sm font-medium text-ink-900">Remove {row.full_name} as {DESKS[held ?? row.desk].label} admin?</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary justify-center" onClick={() => setConfirmRemove(false)}>Cancel</button>
              <button type="button" className="btn-primary justify-center !bg-cyrixRed-600" disabled={busy} onClick={() => void remove()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {row && held
              ? <button type="button" className="btn-secondary justify-center !text-cyrixRed-700" onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" /> Remove</button>
              : <button type="button" className="btn-secondary justify-center" onClick={onClose}>Cancel</button>}
            <button type="button" className="btn-primary justify-center" disabled={busy} onClick={() => void save()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
