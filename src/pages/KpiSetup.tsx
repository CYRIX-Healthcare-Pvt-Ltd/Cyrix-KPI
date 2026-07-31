import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Upload, FileSpreadsheet, Trash2, Plus, ArrowLeft, Send, Save } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSaveAssignmentRows, useAssignmentAction,
  useScoringRules, useTemplatesForRole, currentFy,
} from '@/lib/queries'
import type { ParseResult } from '@/lib/excel'
import type { KpiRowDefinition, Section } from '@/types/db'
import type { ScoringRule } from '@/lib/scoring'
import { Alert, PageLoader, Spinner } from '@/components/ui'

type Draft = KpiRowDefinition & { _key: string; _inferred?: boolean }

const blankRow = (section: Section, sortOrder: number): Draft => ({
  _key: crypto.randomUUID(),
  section,
  kra: '',
  kpi_description: '',
  weightage: 0,
  target_value: null,
  target_unit: null,
  scoring_rule: section === 'core_values' ? 'rating_scale' : 'higher_capped',
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
  const { data: roleTemplate } = useTemplatesForRole(employee?.job_role_id, fy)
  const saveRows = useSaveAssignmentRows()
  const action = useAssignmentAction()

  const [rows, setRows] = useState<Draft[] | null>(null)
  const [parseInfo, setParseInfo] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const assignment = data?.assignment ?? null
  const locked = assignment?.status === 'pending_approval' || assignment?.status === 'active'

  // Server rows become the working draft the first time we see them.
  const working: Draft[] = useMemo(() => {
    if (rows) return rows
    return (data?.items ?? []).map(i => ({ ...i, _key: i.id }))
  }, [rows, data])

  const jobTotal = working.filter(r => r.section === 'job_role')
    .reduce((a, b) => a + (Number(b.weightage) || 0), 0)
  const coreTotal = working.filter(r => r.section === 'core_values')
    .reduce((a, b) => a + (Number(b.weightage) || 0), 0)
  const valid = jobTotal === 80 && coreTotal === 20 && working.length > 0 &&
    working.every(r => r.kra.trim() !== '')

  const update = (key: string, patch: Partial<Draft>) =>
    setRows(working.map(r => (r._key === key ? { ...r, ...patch } : r)))

  const remove = (key: string) => setRows(working.filter(r => r._key !== key))

  const add = (section: Section) =>
    setRows([...working, blankRow(section, working.length + 1)])

  const onFile = async (file: File) => {
    setError(null); setNotice(null)
    try {
      // Loaded on demand — the xlsx parser is large and only this screen needs it.
      const { parseKpiWorkbook } = await import('@/lib/excel')
      const buf = await file.arrayBuffer()
      const parsed = parseKpiWorkbook(buf)
      setParseInfo(parsed)

      if (parsed.rows.length === 0) {
        setError(parsed.errors[0] ?? 'No KPI rows were found in that file.')
        return
      }
      setRows(parsed.rows.map(r => ({
        _key: crypto.randomUUID(),
        section: r.section,
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
      setNotice(`Read ${parsed.rows.length} KPI rows from sheet “${parsed.sheetName}”. Check them below before saving.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  const loadRoleTemplate = () => {
    if (!roleTemplate?.items.length) return
    setParseInfo(null)
    setRows(roleTemplate.items.map(i => ({
      _key: crypto.randomUUID(),
      section: i.section, kra: i.kra, kpi_description: i.kpi_description,
      weightage: i.weightage, target_value: i.target_value, target_unit: i.target_unit,
      scoring_rule: i.scoring_rule, rule_params: i.rule_params, sort_order: i.sort_order,
    })))
    setNotice(`Loaded the standard “${roleTemplate.template?.name}” template. Adjust anything that differs for you.`)
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
        <Link to="/my-kpi" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
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
        <Link to="/my-kpi" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Back to my KPI
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Set up my KPI</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          FY {fy} · job role must total 80%, core values 20%
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {parseInfo?.warnings.map((w, i) => (
        <Alert key={i} kind="warning">{w}</Alert>
      ))}

      {/* ---- starting points ---- */}
      {working.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/40"
          >
            <Upload className="h-7 w-7 text-brand-600" />
            <p className="font-medium text-slate-900">Upload my Excel</p>
            <p className="text-xs text-slate-500">
              Reads the KPI template, including which rows penalise going over target
            </p>
          </button>

          <button
            onClick={loadRoleTemplate}
            disabled={!roleTemplate?.items.length}
            className="card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-7 w-7 text-slate-500" />
            <p className="font-medium text-slate-900">Use my role's template</p>
            <p className="text-xs text-slate-500">
              {roleTemplate?.template?.name ?? 'No template for your job role yet'}
            </p>
          </button>

          <button
            onClick={() => setRows([blankRow('job_role', 1), blankRow('core_values', 2)])}
            className="card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/40"
          >
            <Plus className="h-7 w-7 text-slate-500" />
            <p className="font-medium text-slate-900">Start from blank</p>
            <p className="text-xs text-slate-500">Build the rows by hand</p>
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

      {/* ---- the grid ---- */}
      {working.length > 0 && (
        <>
          {(['job_role', 'core_values'] as Section[]).map(section => {
            const sectionRows = working.filter(r => r.section === section)
            const total = section === 'job_role' ? jobTotal : coreTotal
            const expected = section === 'job_role' ? 80 : 20

            return (
              <div key={section} className="card overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {section === 'job_role' ? 'Job Role' : 'Alignment To Core Values'}
                    <span className="font-normal text-slate-500"> — {expected}%</span>
                  </h3>
                  <span className={`badge ${
                    total === expected ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {total}% of {expected}%
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {sectionRows.map(row => (
                    <RowEditor
                      key={row._key}
                      row={row}
                      rules={rules ?? []}
                      onChange={patch => update(row._key, patch)}
                      onRemove={() => remove(row._key)}
                    />
                  ))}
                </div>

                <button
                  onClick={() => add(section)}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  <Plus className="h-4 w-4" /> Add a row
                </button>
              </div>
            )
          })}

          {!valid && (
            <Alert kind="warning" title="Not ready to submit yet">
              <ul className="list-inside list-disc space-y-0.5">
                {jobTotal !== 80 && <li>Job role weightages total {jobTotal}%, they must total 80%.</li>}
                {coreTotal !== 20 && <li>Core values weightages total {coreTotal}%, they must total 20%.</li>}
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
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn-secondary"
            >
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
              <span className="ml-2 font-normal text-amber-700">
                — guessed, please confirm
              </span>
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
          {ruleMeta && (
            <p className="mt-1 text-xs text-slate-500">{ruleMeta.description}</p>
          )}
        </div>
      </div>

      {/* rule-specific knobs */}
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
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
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
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove this row
      </button>
    </div>
  )
}
