import { useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { Plus, RotateCcw, Save, Search } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { useScoringRules, useCoreValues, type TemplateReach } from '@/lib/queries'
import { ESMS_WEIGHT, JOB_ROLE_TOTAL } from '@/lib/sections'
import { monthLabel } from '@/lib/fy'
import RowEditor, { blankRow, type Draft } from '@/components/KpiRowEditor'
import ReachChoice, { ReachConfirm } from '@/components/ReachChoice'
import { Alert, Spinner } from '@/components/ui'
import type { KpiTemplateItem } from '@/types/db'

/** What admin_kpi_for answers (0146). */
interface Found {
  fy: string
  employee: { id: string; ecode: string; full_name: string; designation: string | null; is_active: boolean }
  assignment: { id: string; status: string; job_role_weight: number | string | null; esms: boolean; template: string | null } | null
  items: KpiTemplateItem[]
  months: Record<string, number>
  /** Each month of the KPI, for moving one or all back to draft (0217). */
  month_list?: Array<{ month: string; status: string; last_day_passed: boolean }>
}

const MONTH_WORD: Record<string, string> = {
  draft: 'draft', submitted: 'submitted', returned: 'returned', scored: 'scored', finalized: 'finalised',
}

// Each row keeps the id of the KPI row it is: months are matched by it, since a KRA heads several KPIs (0148).
const fromItem = (i: KpiTemplateItem, idx: number): Draft => ({
  id: i.id,
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
} as Draft)

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
  // ESMS on or off (0147; the user, 8 Oct: "enable or disable esms also").
  const [esms, setEsms] = useState(false)
  /*
    Team member rates their own core values (0214; the user, 16 Oct), set here for a KPI already
    approved, which the person cannot edit. With it ticked, each core value's weight, adding up to
    the core values share; unticked, they are equal.
  */
  const { data: coreValues } = useCoreValues()
  const [coreSelf, setCoreSelf] = useState(false)
  const [coreTotal, setCoreTotal] = useState(20)
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /*
    Back to draft (0217; the user, 19 Oct: "draft, select month or full month … emp before submitting
    stage"): their own figures stay, the manager's scores for those months go.
  */
  const [mode, setMode] = useState<'edit' | 'draft'>('edit')
  const [picked, setPicked] = useState<string[]>([])

  const load = async (ecode: string) => {
    const { data, error: err } = await supabase.rpc('admin_kpi_for', { p_ecode: ecode })
    if (err) throw new Error(friendlyError(err))
    const f = data as Found
    setFound(f)
    setRows(f.items.map(fromItem))
    setEsms(!!f.assignment?.esms)
    setPicked([])
    if (f.assignment) {
      const { data: a } = await supabase.from('kpi_assignments')
        .select('core_self_rating, core_value_weights, core_values_weight').eq('id', f.assignment.id).maybeSingle()
      const row = a as { core_self_rating?: boolean; core_value_weights?: Record<string, number> | null; core_values_weight?: number | string } | null
      setCoreSelf(!!row?.core_self_rating)
      setCoreTotal(Number(row?.core_values_weight ?? 20))
      setWeights(Object.fromEntries(Object.entries(row?.core_value_weights ?? {}).map(([k, v]) => [k, String(v)])))
    }
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
        p_esms: esms === found.assignment.esms ? null : esms,
      })
      if (err) throw new Error(friendlyError(err))
      // ESMS changes the core values share, so read it again before checking the weights.
      const { data: a } = await supabase.from('kpi_assignments').select('core_values_weight').eq('id', found.assignment.id).maybeSingle()
      const share = Number((a as { core_values_weight?: number | string } | null)?.core_values_weight ?? coreTotal)
      const list = coreValues ?? []
      const w = coreSelf
        ? Object.fromEntries(list.map(cv => [cv.id, weights[cv.id] !== undefined && weights[cv.id] !== '' ? Number(weights[cv.id]) : Math.round((share / list.length) * 100) / 100]))
        : null
      const { error: cvErr } = await supabase.rpc('set_core_value_options', { p_assignment_id: found.assignment.id, p_self: coreSelf, p_weights: w })
      if (cvErr) throw new Error(friendlyError(cvErr))
      const months = Number((data as { months: number }).months ?? 0)
      // Saved is done: the editor closes, the line saying so stays (the user, 8 Oct).
      setFound(null); setRows([]); setCode('')
      setNotice(`Saved ${found.employee.full_name}'s KPI — ${months} month${months === 1 ? '' : 's'} updated.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that KPI.')
    } finally {
      setBusy(false)
    }
  }

  const monthLine = found && Object.entries(found.months).map(([s, n]) => `${n} ${MONTH_WORD[s] ?? s}`).join(' · ')

  // A month already a draft, or past its last day to submit, cannot be chosen.
  const movable = (found?.month_list ?? []).filter(m => m.status !== 'draft' && !m.last_day_passed).map(m => m.month)
  const allPicked = movable.length > 0 && movable.every(m => picked.includes(m))
  const toDraft = async () => {
    if (!found?.assignment || picked.length === 0) return
    const names = picked.slice().sort().map(monthLabel).join(', ')
    if (!confirm(`Move ${names} of ${found.employee.full_name} back to draft? Their own figures stay; the manager's scores for ${picked.length === 1 ? 'this month' : 'these months'} are cleared.`)) return
    setError(null); setNotice(null); setBusy(true)
    try {
      const { data, error: err } = await supabase.rpc('admin_kpi_to_draft', {
        p_assignment_id: found.assignment.id, p_months: allPicked ? null : picked,
      })
      if (err) throw new Error(friendlyError(err))
      const list = ((data as { list?: string[] }).list ?? []).join(', ')
      await load(found.employee.ecode)
      setNotice(`${list || names} of ${found.employee.full_name} moved back to draft.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move that month back to draft.')
    } finally {
      setBusy(false)
    }
  }

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
        <div className="flex w-fit gap-1 rounded-lg bg-ink-100 p-1">
          {([['edit', 'Edit KPI'], ['draft', 'Back to draft']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)} aria-current={mode === k ? 'page' : undefined}
              className={clsx('whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors',
                mode === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900')}>
              {label}
            </button>
          ))}
        </div>
      )}

      {found?.assignment && mode === 'draft' && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={movable.length === 0} onClick={() => setPicked(allPicked ? [] : movable)}
              className={clsx('rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40',
                allPicked ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-ink-200 text-ink-900 hover:bg-ink-50')}>
              All months
            </button>
            {(found.month_list ?? []).map(m => {
              const can = movable.includes(m.month), on = picked.includes(m.month)
              return (
                <button key={m.month} type="button" disabled={!can} aria-pressed={on}
                  title={m.last_day_passed && m.status !== 'draft' ? 'The last day to submit has passed' : undefined}
                  onClick={() => setPicked(on ? picked.filter(x => x !== m.month) : [...picked, m.month])}
                  className={clsx('rounded-lg border px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50',
                    on ? 'border-violet-500 bg-violet-50' : 'border-ink-200 hover:bg-ink-50')}>
                  <span className="block text-sm font-semibold text-ink-900">{monthLabel(m.month)}</span>
                  <span className="block text-xs text-ink-500">{m.last_day_passed && m.status !== 'draft' ? 'last day passed' : MONTH_WORD[m.status] ?? m.status}</span>
                </button>
              )
            })}
          </div>
          {(found.month_list ?? []).length === 0 && <p className="text-sm text-ink-500">No months yet.</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void toDraft()} disabled={busy || picked.length === 0} className="btn-primary">
              {busy ? <Spinner className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />} Move to draft
            </button>
            <button onClick={() => { setFound(null); setRows([]); setCode(''); setError(null); setNotice(null) }} disabled={busy} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {found?.assignment && mode === 'edit' && (
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
            <label className={`flex w-fit cursor-pointer items-center gap-2.5 rounded-lg border-2 px-3 py-2 text-sm font-semibold ${coreSelf ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-violet-300 text-violet-800 hover:border-violet-500'}`}>
              <input type="checkbox" className="accent-violet-600" checked={coreSelf}
                onChange={e => { if (!e.target.checked || confirm(`${found?.employee.full_name ?? 'This person'} will rate every core value each month, with a comment on each. The manager's rating is what counts. Turn it on?`)) setCoreSelf(e.target.checked) }} />
              Team member rates core values
            </label>
            {coreSelf && (
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {(coreValues ?? []).map(cv => (
                  <li key={cv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-ink-900">{cv.name}</span>
                    <span className="flex items-center gap-1">
                      <input type="number" min={0} step="0.5" className="input w-20 text-right" aria-label={`Weight of ${cv.name}`}
                        placeholder={String(Math.round((coreTotal / Math.max(1, (coreValues ?? []).length)) * 100) / 100)}
                        value={weights[cv.id] ?? ''} onChange={e => setWeights({ ...weights, [cv.id]: e.target.value })} />
                      <span className="text-ink-500">%</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <label className="flex w-fit cursor-pointer items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-900 hover:bg-ink-50">
              <input type="checkbox" checked={esms} onChange={e => setEsms(e.target.checked)} />
              ESMS <span className="font-normal text-ink-500">— {ESMS_WEIGHT}%</span>
            </label>
            <ReachChoice value={reach} onChange={setReach} name="reach-admin-edit" />
            {confirming && (
              <ReachConfirm
                reach={reach}
                who={found ? `${found.employee.full_name}'s KPI` : undefined}
                busy={busy}
                onConfirm={() => { setConfirming(false); void save() }}
                onCancel={() => setConfirming(false)}
              />
            )}
            <div className="flex flex-wrap gap-2">
            <button onClick={() => setConfirming(true)} disabled={busy || total !== job || named.length === 0} className="btn-primary">
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
