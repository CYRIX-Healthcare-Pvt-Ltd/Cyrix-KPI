import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Upload, FileSpreadsheet, Trash2, Plus, ArrowLeft, Send, Save, Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSaveAssignmentRows, useAssignmentAction,
  useScoringRules, useTemplatesForRole, useCoreValues, currentFy,
} from '@/lib/queries'
import type { ParseResult } from '@/lib/excel'
import type { KpiRowDefinition } from '@/types/db'
import type { ScoringRule } from '@/lib/scoring'
import { Alert, PageLoader, Spinner } from '@/components/ui'

/**
 * Team members define their Job Role rows only — the 20% core values
 * block is identical company-wide and is attached by the system, so it is
 * shown here for reference but is not editable.
 */
const JOB_ROLE_TOTAL = 80

type Draft = KpiRowDefinition & { _key: string; _inferred?: boolean }

const blankRow = (sortOrder: number): Draft => ({
  _key: crypto.randomUUID(),
  section: 'job_role',
  kra: '',
  kpi_description: '',
  weightage: 0,
  target_value: null,
  target_unit: null,
  scoring_rule: 'higher_capped',
  rule_params: {},
  sort_order: sortOrder,
})

export default function KpiSetup() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const fy = currentFy()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useMyAssignment(employee?.id, fy)
  const { data: rules } = useScoringRules()
  const { data: coreValues } = useCoreValues()
  const { data: roleTemplate } = useTemplatesForRole(employee?.job_role_id, fy)
  const saveRows = useSaveAssignmentRows()
  const action = useAssignmentAction()

  const [rows, setRows] = useState<Draft[] | null>(null)
  const [parseInfo, setParseInfo] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const assignment = data?.assignment ?? null
  const locked = assignment?.status === 'pending_approval' || assignment?.status === 'active'

  // Only job role rows are editable; core values are filtered out entirely.
  const working: Draft[] = useMemo(() => {
    if (rows) return rows
    return (data?.items ?? [])
      .filter(i => i.section === 'job_role')
      .map(i => ({ ...i, _key: i.id }))
  }, [rows, data])

  const jobTotal = working.reduce((a, b) => a + (Number(b.weightage) || 0), 0)
  const valid =
    jobTotal === JOB_ROLE_TOTAL &&
    working.length > 0 &&
    working.every(r => r.kra.trim() !== '')

  const update = (key: string, patch: Partial<Draft>) =>
    setRows(working.map(r => (r._key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => setRows(working.filter(r => r._key !== key))
  const add = () => setRows([...working, blankRow(working.length + 1)])

  const onFile = async (file: File) => {
    setError(null); setNotice(null)
    try {
      const { parseKpiWorkbook } = await import('@/lib/excel')
      const buf = await file.arrayBuffer()
      const parsed = parseKpiWorkbook(buf)
      setParseInfo(parsed)

      const jobRows = parsed.rows.filter(r => r.section === 'job_role')
      if (jobRows.length === 0) {
        setError(parsed.errors[0] ?? 'No Job Role rows were found in that file.')
        return
      }

      setRows(jobRows.map(r => ({
        _key: crypto.randomUUID(),
        section: 'job_role' as const,
        kra: r.kra,
        kpi_description: r.kpi_description,
        weightage: r.weightage,
        target_value: r.target_value,
        target_unit: r.target_unit,
        scoring_rule: r.scoring_rule,
        rule_params: r.rule_params,
        sort_order: r.sort_order,
        _inferred: r.rule_inferred,
      })))

      const skipped = parsed.rows.length - jobRows.length
      setNotice(
        `Read ${jobRows.length} Job Role row(s) from sheet “${parsed.sheetName}”.` +
        (skipped > 0
          ? ` The ${skipped} core values row(s) were ignored — those are standard for everyone.`
          : ''),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const loadRoleTemplate = () => {
    const jobRows = (roleTemplate?.items ?? []).filter(i => i.section === 'job_role')
    if (jobRows.length === 0) return
    setParseInfo(null)
    setRows(jobRows.map(i => ({
      _key: crypto.randomUUID(),
      section: 'job_role' as const,
      kra: i.kra, kpi_description: i.kpi_description,
      weightage: i.weightage, target_value: i.target_value, target_unit: i.target_unit,
      scoring_rule: i.scoring_rule, rule_params: i.rule_params, sort_order: i.sort_order,
    })))
    setNotice(`Loaded the standard “${roleTemplate?.template?.name}” rows. Adjust anything that differs for you.`)
  }

  const persist = async () => {
    if (!employee) return null
    setError(null)
    try {
      return await saveRows.mutateAsync({
        employeeId: employee.id,
        fy,
        existingAssignmentId: assignment?.id ?? null,
        sourceTemplateId: roleTemplate?.template?.id ?? null,
        rows: working.map(({ _key, _inferred, ...r }, idx) => {
          void _key; void _inferred
          return { ...r, sort_order: idx + 1 }
        }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      return null
    }
  }

  const onSaveDraft = async () => {
    const id = await persist()
    if (id) { setNotice('Saved as a draft. Nothing has been sent to your manager yet.'); setRows(null) }
  }

  const onSubmit = async () => {
    const id = await persist()
    if (!id) return
    try {
      await action.mutateAsync({ action: 'submit', assignmentId: id })
      navigate('/my-kpi')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit.')
    }
  }

  if (isLoading) return <PageLoader />

  if (locked) {
    return (
      <div className="space-y-4">
        <Link to="/my-kpi" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Back to my KPI
        </Link>
        <Alert kind="info" title={
          assignment?.status === 'active'
            ? 'Your KPI is approved and locked for this year'
            : 'Your KPI is with your manager'
        }>
          {assignment?.status === 'active'
            ? 'Contact HR if something genuinely needs to change mid-year.'
            : 'You can make changes again if your manager sends it back.'}
        </Alert>
      </div>
    )
  }

  const busy = saveRows.isPending || action.isPending

  return (
    <div className="space-y-5">
      <div>
        <Link to="/my-kpi" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Back to my KPI
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">Set up my KPI</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          FY {fy} · define your Job Role KRAs, totalling {JOB_ROLE_TOTAL}%
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {parseInfo?.warnings.map((w, i) => <Alert key={i} kind="warning">{w}</Alert>)}

      {working.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-ink-400 hover:bg-ink-50"
          >
            <Upload className="h-7 w-7 text-ink-800" />
            <p className="font-medium text-ink-900">Upload my Excel</p>
            <p className="text-xs text-ink-500">
              Reads your KPI sheet, including which rows penalise going over target
            </p>
          </button>

          <button
            onClick={loadRoleTemplate}
            disabled={!(roleTemplate?.items ?? []).some(i => i.section === 'job_role')}
            className="card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-ink-400 hover:bg-ink-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-7 w-7 text-ink-500" />
            <p className="font-medium text-ink-900">Use my role's template</p>
            <p className="text-xs text-ink-500">
              {roleTemplate?.template?.name ?? 'No template for your job role yet'}
            </p>
          </button>

          <button
            onClick={() => setRows([blankRow(1)])}
            className="card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-ink-400 hover:bg-ink-50"
          >
            <Plus className="h-7 w-7 text-ink-500" />
            <p className="font-medium text-ink-900">Start from blank</p>
            <p className="text-xs text-ink-500">Build the rows by hand</p>
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />

      {working.length > 0 && (
        <>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <h3 className="text-sm font-semibold text-ink-800">
                Job Role <span className="font-normal text-ink-500">— {JOB_ROLE_TOTAL}%</span>
              </h3>
              <span className={`badge ${
                jobTotal === JOB_ROLE_TOTAL
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-cyrixRed-100 text-cyrixRed-800'
              }`}>
                {jobTotal}% of {JOB_ROLE_TOTAL}%
              </span>
            </div>

            <div className="divide-y divide-ink-100">
              {working.map(row => (
                <RowEditor
                  key={row._key}
                  row={row}
                  rules={(rules ?? []).filter(r => r.code !== 'rating_scale')}
                  onChange={patch => update(row._key, patch)}
                  onRemove={() => remove(row._key)}
                />
              ))}
            </div>

            <button
              onClick={add}
              className="flex w-full items-center justify-center gap-1.5 border-t border-ink-100 py-2.5 text-sm font-medium text-ink-900 hover:bg-ink-50"
            >
              <Plus className="h-4 w-4" /> Add a row
            </button>
          </div>

          {/* Read-only: identical for everyone, so nobody sets their own. */}
          <div className="card overflow-hidden opacity-90">
            <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                <Lock className="h-3.5 w-3.5 text-ink-400" />
                Alignment To Core Values <span className="font-normal text-ink-500">— 20%</span>
              </h3>
              <span className="badge bg-ink-100 text-ink-600">Standard for everyone</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm text-ink-500">
                Rated each month against the five company core values. Nothing to set up here.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {(coreValues ?? []).map(cv => (
                  <li key={cv.id} className="badge bg-ink-100 text-ink-700">{cv.name}</li>
                ))}
              </ul>
            </div>
          </div>

          {!valid && (
            <Alert kind="warning" title="Not ready to submit yet">
              <ul className="list-inside list-disc space-y-0.5">
                {jobTotal !== JOB_ROLE_TOTAL && (
                  <li>
                    Job Role weightages total {jobTotal}%, they must total {JOB_ROLE_TOTAL}%
                    {jobTotal > JOB_ROLE_TOTAL
                      ? ` — remove ${jobTotal - JOB_ROLE_TOTAL}%.`
                      : ` — add ${JOB_ROLE_TOTAL - jobTotal}%.`}
                  </li>
                )}
                {working.some(r => !r.kra.trim()) && <li>Every row needs a KRA name.</li>}
              </ul>
            </Alert>
          )}

          <div className="sticky bottom-16 flex flex-wrap gap-2 md:bottom-0">
            <button onClick={onSubmit} disabled={!valid || busy} className="btn-primary">
              {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              Submit to my manager
            </button>
            <button onClick={onSaveDraft} disabled={busy} className="btn-secondary">
              <Save className="h-4 w-4" /> Save draft
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary">
              <Upload className="h-4 w-4" /> Replace from Excel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function RowEditor({
  row, rules, onChange, onRemove,
}: {
  row: Draft
  rules: Array<{ code: string; label: string; description: string }>
  onChange: (patch: Partial<Draft>) => void
  onRemove: () => void
}) {
  const ruleMeta = rules.find(r => r.code === row.scoring_rule)

  return (
    <div className={`p-4 ${row._inferred ? 'bg-amber-50/60' : ''}`}>
      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <label className="label text-xs">KRA</label>
          <input
            className="input"
            value={row.kra}
            onChange={e => onChange({ kra: e.target.value })}
            placeholder="e.g. Response time"
          />
        </div>

        <div className="sm:col-span-8">
          <label className="label text-xs">KPI — measurable parameter</label>
          <input
            className="input"
            value={row.kpi_description ?? ''}
            onChange={e => onChange({ kpi_description: e.target.value })}
            placeholder="e.g. BD calls assigned to be attended within 48 hours"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label text-xs">Weightage %</label>
          <input
            type="number" inputMode="decimal" min={0} max={100} step="any"
            className="input"
            value={row.weightage}
            onChange={e => onChange({ weightage: Number(e.target.value) })}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label text-xs">Target</label>
          <input
            type="number" inputMode="decimal" step="any"
            className="input"
            value={row.target_value ?? ''}
            onChange={e => onChange({
              target_value: e.target.value === '' ? null : Number(e.target.value),
            })}
          />
        </div>

        <div className="sm:col-span-8">
          <label className="label text-xs">
            How is it scored?
            {row._inferred && (
              <span className="ml-2 font-normal text-amber-700">— guessed, please confirm</span>
            )}
          </label>
          <select
            className="input"
            value={row.scoring_rule}
            onChange={e => onChange({
              scoring_rule: e.target.value as ScoringRule,
              _inferred: false,
            })}
          >
            {rules.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
          {ruleMeta && <p className="mt-1 text-xs text-ink-500">{ruleMeta.description}</p>}
        </div>
      </div>

      {row.scoring_rule === 'higher_uncapped' && (
        <div className="mt-3 max-w-xs">
          <label className="label text-xs">Ceiling (× weightage, blank = none)</label>
          <input
            type="number" inputMode="decimal" step="0.1" min={1}
            className="input"
            value={row.rule_params.max_multiplier ?? ''}
            onChange={e => onChange({
              rule_params: {
                ...row.rule_params,
                max_multiplier: e.target.value === '' ? undefined : Number(e.target.value),
              },
            })}
            placeholder="e.g. 1.2 for up to 120%"
          />
        </div>
      )}

      {row.scoring_rule === 'lower_linear' && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300"
              checked={!!row.rule_params.allow_negative}
              onChange={e => onChange({
                rule_params: { ...row.rule_params, allow_negative: e.target.checked },
              })}
            />
            Allow a negative score
          </label>
          {row.rule_params.allow_negative && (
            <div className="w-32">
              <label className="label text-xs">Lowest possible</label>
              <input
                type="number" inputMode="decimal" step="any"
                className="input"
                value={row.rule_params.floor ?? ''}
                onChange={e => onChange({
                  rule_params: {
                    ...row.rule_params,
                    floor: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })}
                placeholder="e.g. -5"
              />
            </div>
          )}
        </div>
      )}

      <button
        onClick={onRemove}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-cyrixRed-700 hover:text-cyrixRed-800"
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove this row
      </button>
    </div>
  )
}
