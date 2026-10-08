import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Plus, Save, Search } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { useScoringRules, type TemplateReach } from '@/lib/queries'
import { JOB_ROLE_TOTAL } from '@/lib/sections'
import RowEditor, { blankRow, type Draft } from '@/components/KpiRowEditor'
import ReachChoice from '@/components/ReachChoice'
import { Alert, Spinner } from '@/components/ui'
import type { KpiTemplateItem } from '@/types/db'

/** What admin_kpi_for answers (0146). */
interface Found {
  fy: string
  employee: { id: string; ecode: string; full_name: string; designation: string | null; is_active: boolean }
  assignment: { id: string; status: string; job_role_weight: number | string | null; template: string | null } | null
  items: KpiTemplateItem[]
  months: Record<string, number>
}

const MONTH_WORD: Record<string, string> = {
  draft: 'draft', submitted: 'submitted', returned: 'returned', scored: 'scored', finalized: 'finalised',
}

const fromItem = (i: KpiTemplateItem, idx: number): Draft => ({
  _key: crypto.randomUUID(),
  section: 'job_role',
  kra: i.kra,
  kpi_description: i.kpi_description,
  weightage: Number(i.weightage) || 0,
  target_value: i.target_value === null ? null : Number(i.target_value),
  target_unit: i.target_unit,
  scoring_rule: i.scoring_rule,
  rule_params: i.rule_params ?? {},
  sort_order: idx + 1,
  alternates: i.alternates ?? [],
})

/**
 * One person's KPI, edited by the software administrator (0146; the user,
 * 8 Oct: "i search a ecode, then his kpi edit option, then like we have
 * that 3 option"). The same row editor as a template, and the same three
 * choices for how far back the change goes.
 */
export default function KpiEdit() {
  const { data: rules } = useScoringRules()
  const [code, setCode] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [rows, setRows] = useState<Draft[]>([])
  const [reach, setReach] = useState<TemplateReach>('forward')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async (ecode: string) => {
    const { data, error: err } = await supabase.rpc('admin_kpi_for', { p_ecode: ecode })
    if (err) throw new Error(friendlyError(err))
    const f = data as Found
    setFound(f)
    setRows(f.items.map(fromItem))
    return f
  }

  const find = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setNotice(null); setFound(null)
    if (!code.trim()) return
    setBusy(true)
    try { await load(code.trim()) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not find that person.') }
    finally { setBusy(false) }
  }

  const job = Number(found?.assignment?.job_role_weight ?? JOB_ROLE_TOTAL)
  const named = rows.filter(r => r.kra.trim() !== '')
  const total = named.reduce((a, r) => a + (Number(r.weightage) || 0), 0)
  const update = (key: string, patch: Partial<Draft>) => setRows(rows.map(r => (r._key === key ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!found?.assignment) return
    setError(null); setNotice(null); setBusy(true)
    const payload = named.map(({ _key, _inferred, section, sort_order, ...r }) => {
      void _key; void _inferred; void section; void sort_order
      return { ...r, kpi_description: r.kpi_description?.trim() || null, alternates: r.alternates.filter(a => a.kra.trim() !== '') }
    })
    try {
      const { data, error: err } = await supabase.rpc('admin_edit_assignment', {
        p_assignment_id: found.assignment.id, p_rows: payload, p_mode: reach,
      })
      if (err) throw new Error(friendlyError(err))
      const months = Number((data as { months: number }).months ?? 0)
      await load(found.employee.ecode)
      setNotice(`Saved ${found.employee.full_name}'s KPI — ${months} month${months === 1 ? '' : 's'} updated.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that KPI.')
    } finally {
      setBusy(false)
    }
  }

  const monthLine = found && Object.entries(found.months).map(([s, n]) => `${n} ${MONTH_WORD[s] ?? s}`).join(' · ')

  return (
    <div className="space-y-4">
      <form onSubmit={find} className="flex flex-wrap items-end gap-2">
        <label className="block w-44">
          <span className="label">Employee code</span>
          <input className="input mt-1 font-mono uppercase" value={code} onChange={e => setCode(e.target.value)} placeholder="E1427" />
        </label>
        <button type="submit" className="btn-secondary" disabled={busy || !code.trim()}>
          {busy && !found ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />} Find
        </button>
      </form>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {found && (
        <div className="card p-4">
          <p className="font-medium text-ink-900">
            {found.employee.full_name} <span className="font-mono text-sm text-ink-500">{found.employee.ecode}</span>
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            {[found.employee.designation, found.assignment?.template && `on ${found.assignment.template}`, found.fy, monthLine].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {found && !found.assignment && (
        <Alert kind="info">{found.employee.full_name} has no KPI in use for {found.fy}.</Alert>
      )}

      {found?.assignment && (
        <>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <h3 className="text-sm font-semibold text-ink-800">
                Job Role rows <span className="font-normal text-ink-500">— {job}%</span>
              </h3>
              <span className={clsx('badge', total === job ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
                {total}% of {job}%
              </span>
            </div>
            <div className="divide-y divide-ink-100">
              {rows.map((row, i) => (
                <RowEditor
                  key={row._key}
                  row={row}
                  index={i + 1}
                  rules={(rules ?? []).filter(r => r.is_selectable)}
                  onChange={patch => update(row._key, patch)}
                  onRemove={() => setRows(rows.filter(r => r._key !== row._key))}
                />
              ))}
            </div>
            <button
              onClick={() => setRows([...rows, blankRow(rows.length + 1)])}
              className="flex w-full items-center justify-center gap-1.5 border-t border-ink-100 py-2.5 text-sm font-medium text-ink-900 hover:bg-ink-50"
            >
              <Plus className="h-4 w-4" /> Add a row
            </button>
          </div>

          <div className="card space-y-3 p-4">
            <ReachChoice value={reach} onChange={setReach} name="reach-admin-edit" />
            <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={busy || total !== job || named.length === 0} className="btn-primary">
              {busy ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save and apply
            </button>
            <button onClick={() => { setFound(null); setRows([]); setCode(''); setError(null); setNotice(null) }} disabled={busy} className="btn-secondary">
              Cancel
            </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
