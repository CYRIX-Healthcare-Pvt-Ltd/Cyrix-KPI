import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Upload, FileSpreadsheet, Trash2, Plus, ArrowLeft, Send, Save, Lock,
  Calculator, Shuffle, ArrowUp, ArrowDown, Minus,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSaveAssignmentRows, useAssignmentAction,
  useScoringRules, useTemplatesForRole, useCoreValues, currentFy,
} from '@/lib/queries'
import type { ParseResult } from '@/lib/excel'
import type { KpiRowDefinition, Alternate, ScoringRuleMeta } from '@/types/db'
import type { ScoringRule } from '@/lib/scoring'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL, ESMS_WEIGHT } from '@/lib/sections'
import { Alert, PageLoader, Spinner } from '@/components/ui'

/**
 * Team members define their Job Role rows only. The remaining 20% is
 * standard — core values for everyone, and for the people who carry an
 * ESMS obligation, 5% of that 20% moves to ESMS. Both are attached by
 * the system, so they are shown here for reference and are not editable.
 */

type Draft = KpiRowDefinition & {
  _key: string
  _inferred?: boolean
  /** Other things this row could measure — see migration 0040. */
  alternates: Alternate[]
}

/**
 * Which way is good, said with a colour and an arrow.
 *
 * "Higher is better" and "lower is better" are opposite meanings wearing
 * the same sentence shape, and this control was the quietest on a form
 * where it decides the most — whether beating a target earns anything,
 * and whether going over is good or bad.
 */
const DIRECTION = {
  higher_better: { label: 'Higher is better', icon: ArrowUp, chip: 'bg-emerald-100 text-emerald-800' },
  lower_better:  { label: 'Lower is better',  icon: ArrowDown, chip: 'bg-cyrixRed-100 text-cyrixRed-800' },
  neutral:       { label: 'Rated',            icon: Minus, chip: 'bg-ink-100 text-ink-700' },
} as const

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
  alternates: [],
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
  // null until the saved answer is known, so a draft that already has
  // ESMS does not flash as unticked and then correct itself.
  const [esmsChoice, setEsmsChoice] = useState<boolean | null>(null)

  const assignment = data?.assignment ?? null
  const locked = assignment?.status === 'pending_approval' || assignment?.status === 'active'
  const esms = esmsChoice ?? Number(assignment?.esms_weight ?? 0) > 0
  const coreWeight = esms ? REMAINDER_TOTAL - ESMS_WEIGHT : REMAINDER_TOTAL

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
        alternates: [],
        _inferred: r.rule_inferred,
      })))

      // The sheet decides whether this person carries ESMS. Its actual
      // ESMS row is not imported: like core values, the wording and the
      // 5% are standard, so the system's own row is stamped on instead
      // of whatever the spreadsheet happened to say.
      setEsmsChoice(parsed.hasEsms)

      const skipped = parsed.rows.length - jobRows.length
      setNotice(
        `Read ${jobRows.length} Job Role row(s) from sheet “${parsed.sheetName}”.` +
        (parsed.hasEsms
          ? ' The sheet has an ESMS band, so ESMS is switched on at 5% and core values' +
            ` sit at ${REMAINDER_TOTAL - ESMS_WEIGHT}%.`
          : '') +
        (skipped > 0
          ? ` The other ${skipped} standard row(s) were not imported — those are the same` +
            ' for everyone and are added automatically.'
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
      alternates: [],
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
        esms,
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
    if (id) {
      setNotice('Saved as a draft. Nothing has been sent to your manager yet.')
      // Back to reading from the saved assignment, both of them, so what
      // is on screen is what is in the database.
      setRows(null); setEsmsChoice(null)
    }
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
            className="card card-interactive flex flex-col items-center gap-2 p-6 text-center"
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
            className="card card-interactive flex flex-col items-center gap-2 p-6 text-center disabled:opacity-50"
          >
            <FileSpreadsheet className="h-7 w-7 text-ink-500" />
            <p className="font-medium text-ink-900">Use my role's template</p>
            <p className="text-xs text-ink-500">
              {roleTemplate?.template?.name ?? 'No template for your job role yet'}
            </p>
          </button>

          <button
            onClick={() => setRows([blankRow(1)])}
            className="card card-interactive flex flex-col items-center gap-2 p-6 text-center"
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
                  // Retired rules stay in the table so rows already using
                  // one keep working and keep their label; they are just
                  // not offered as a new choice.
                  rules={(rules ?? []).filter(r => r.is_selectable)}
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

          {/*
            The other 20%. Read-only rows, but one real decision: whether
            ESMS applies. It is a checkbox rather than a weightage field
            because the split is not negotiable — 5% and 15%, or 0% and
            20%. Letting someone type the numbers only creates ways for
            them not to add up.
          */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                <Lock className="h-3.5 w-3.5 text-ink-400" />
                The other {REMAINDER_TOTAL}%
              </h3>
              <span className="badge bg-ink-100 text-ink-600">Standard, added for you</span>
            </div>

            <label className="flex cursor-pointer items-start gap-3 border-b border-ink-100 px-4 py-3 hover:bg-ink-50">
              <input
                type="checkbox"
                checked={esms}
                onChange={e => setEsmsChoice(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 accent-cyrixRed-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">
                  ESMS applies to my role
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  Incident reporting within TAT, report submission, quality management
                  and training. Worth {ESMS_WEIGHT}%, taken out of core values — your Job
                  Role stays at {JOB_ROLE_TOTAL}%.
                </span>
              </span>
            </label>

            {esms && (
              <div className="flex items-baseline justify-between gap-3 border-b border-ink-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    ESMS Monitoring and reporting
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Scored out of a fixed target of 100 each month, like a Job Role row.
                  </p>
                </div>
                <span className="badge shrink-0 bg-ink-100 text-ink-700">{ESMS_WEIGHT}%</span>
              </div>
            )}

            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">Alignment To Core Values</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Rated each month against the five company core values.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(coreValues ?? []).map(cv => (
                    <li key={cv.id} className="badge bg-ink-100 text-ink-700">{cv.name}</li>
                  ))}
                </ul>
              </div>
              <span className="badge shrink-0 bg-ink-100 text-ink-700">{coreWeight}%</span>
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
  rules: ScoringRuleMeta[]
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

        {/*
          Boxed and tinted, because this was the quietest control on the
          form and the most consequential. It decides whether 60 out of a
          target of 50 is full marks or a bonus, and whether going over is
          good or bad — and it sat in the same grey helper text as
          everything else, so people picked whatever was already selected.

          The direction gets an arrow and a colour of its own: "higher is
          better" and "lower is better" are opposite meanings sharing a
          sentence shape, and an arrow says which one before the sentence
          is read.
        */}
        <div className="sm:col-span-8">
          <div className={clsx(
            'rounded-lg border p-3',
            row._inferred
              ? 'border-amber-300 bg-amber-50'
              : 'border-ink-200 bg-ink-50/70',
          )}>
            <label className="label mb-1.5 flex flex-wrap items-center gap-2 text-xs">
              <Calculator className="h-3.5 w-3.5 text-ink-400" />
              How is it scored?
              {ruleMeta && (
                <span className={clsx(
                  'badge gap-1 normal-case tracking-normal',
                  DIRECTION[ruleMeta.direction].chip,
                )}>
                  {(() => {
                    const Icon = DIRECTION[ruleMeta.direction].icon
                    return <Icon className="h-3 w-3" />
                  })()}
                  {DIRECTION[ruleMeta.direction].label}
                </span>
              )}
              {row._inferred && (
                <span className="font-semibold text-amber-800">
                  guessed — please check
                </span>
              )}
            </label>
            <select
              className="input bg-white"
              value={row.scoring_rule}
              onChange={e => {
                const rule = e.target.value as ScoringRule
                onChange({
                  scoring_rule: rule,
                  _inferred: false,
                  // The behaviour each rule promises, set from the choice
                  // rather than asked for separately. "Can exceed weightage"
                  // means no ceiling; "can go negative" means exactly that,
                  // and the label would be a lie if a hidden default clamped
                  // it at zero.
                  rule_params: {
                    ...row.rule_params,
                    max_multiplier: undefined,
                    allow_negative: rule === 'lower_linear' ? true : undefined,
                    floor: undefined,
                  },
                })
              }}
            >
              {rules.map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
            {ruleMeta && (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
                {ruleMeta.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- alternatives ---- */}
      {row.alternates.length > 0 && (
        <div className="mt-3 space-y-3 border-l-2 border-ink-200 pl-4">
          <p className="text-xs text-ink-500">
            Some months this row measures something else instead. Same{' '}
            <strong>{row.weightage}%</strong> either way — only one applies in
            any month, and the person picks which when they fill it in.
          </p>
          {row.alternates.map((alt, i) => (
            <AlternateEditor
              key={alt.id}
              alt={alt}
              rules={rules}
              index={i}
              onChange={patch => onChange({
                alternates: row.alternates.map(a =>
                  a.id === alt.id ? { ...a, ...patch } : a),
              })}
              onRemove={() => onChange({
                alternates: row.alternates.filter(a => a.id !== alt.id),
              })}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyrixRed-700 hover:text-cyrixRed-800"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove this row
        </button>
        {/* Same weight of text as Remove, deliberately: they are the two
            things you can do to a row, and one of them being a button
            would make it look like the expected next step. Five is the
            cap the column enforces. */}
        {row.alternates.length < 5 && (
          <button
            onClick={() => onChange({
              alternates: [...row.alternates, {
                id: `alt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kra: '', kpi_description: '', target_value: null,
                scoring_rule: row.scoring_rule, rule_params: row.rule_params,
              }],
            })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink-900"
          >
            <Shuffle className="h-3.5 w-3.5" /> Add an alternative
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * A different thing the same row could measure.
 *
 * No weightage field: taking the parent's is the whole idea. If an
 * alternative could carry its own, it would be a second row, the year
 * would stop totalling 100, and the thing this exists to avoid would be
 * back.
 */
function AlternateEditor({
  alt, rules, index, onChange, onRemove,
}: {
  alt: Alternate
  rules: ScoringRuleMeta[]
  index: number
  onChange: (patch: Partial<Alternate>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-label text-ink-400">
          Alternative {index + 1}
        </p>
        <button
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-cyrixRed-700 hover:text-cyrixRed-800"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-4">
          <label className="label text-xs">KRA</label>
          <input
            className="input"
            value={alt.kra}
            onChange={e => onChange({ kra: e.target.value })}
            placeholder="What is measured instead"
          />
        </div>
        <div className="sm:col-span-8">
          <label className="label text-xs">KPI — measurable parameter</label>
          <input
            className="input"
            value={alt.kpi_description ?? ''}
            onChange={e => onChange({ kpi_description: e.target.value })}
          />
        </div>
        <div className="sm:col-span-3">
          <label className="label text-xs">Target</label>
          <input
            type="number" inputMode="decimal" step="any"
            className="input"
            value={alt.target_value ?? ''}
            onChange={e => onChange({
              target_value: e.target.value === '' ? null : Number(e.target.value),
            })}
          />
        </div>
        <div className="sm:col-span-9">
          <label className="label text-xs">How is it scored?</label>
          <select
            className="input"
            value={alt.scoring_rule}
            onChange={e => onChange({ scoring_rule: e.target.value as ScoringRule })}
          >
            {rules.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
