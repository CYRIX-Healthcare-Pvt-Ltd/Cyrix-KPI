import { useState, useMemo, useRef, useId } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Upload, FileSpreadsheet, Trash2, Plus, ArrowLeft, Send, Save, Lock,
  Calculator, Shuffle, ArrowUp, ArrowDown, Minus, FlaskConical, TrendingDown,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSaveAssignmentRows, useAssignmentAction, useSetKpiStart,
  useScoringRules, useTemplatesForRole, useCoreValues, currentFy,
} from '@/lib/queries'
import { defaultStartMonth, fyMonths } from '@/lib/fy'
import { StartMonthSelect, StartMonthNote } from '@/components/StartMonth'
import RuleTraits from '@/components/RuleTraits'
import type { ParseResult } from '@/lib/excel'
import type { KpiRowDefinition, Alternate, ScoringRuleMeta } from '@/types/db'
import { calcKpiScore, type ScoringRule, type RuleParams } from '@/lib/scoring'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL, ESMS_WEIGHT } from '@/lib/sections'
import {
  Alert, PageLoader, Spinner, NumberInput, cleanNumberText,
} from '@/components/ui'
import { bandFor, attainmentPct } from '@/lib/bands'

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
  const setStart = useSetKpiStart()

  const [rows, setRows] = useState<Draft[] | null>(null)
  const [parseInfo, setParseInfo] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // null until the saved answer is known, so a draft that already has
  // ESMS does not flash as unticked and then correct itself.
  const [esmsChoice, setEsmsChoice] = useState<boolean | null>(null)
  const [startChoice, setStartChoice] = useState<string | null>(null)

  const assignment = data?.assignment ?? null
  const locked = assignment?.status === 'pending_approval' || assignment?.status === 'active'
  const esms = esmsChoice ?? Number(assignment?.esms_weight ?? 0) > 0
  // Saved answer, else the month they joined, else April. Never blank —
  // an unanswerable-looking question is how you get twelve people
  // guessing, and the joining date is already known.
  const startMonth = startChoice
    ?? assignment?.starts_from
    ?? defaultStartMonth(fy, employee?.date_of_joining)
  // Its position in the year is exactly how many months it skips.
  const skippedMonths = Math.max(0, fyMonths(fy).indexOf(startMonth))
  const coreWeight = esms ? REMAINDER_TOTAL - ESMS_WEIGHT : REMAINDER_TOTAL

  // Only job role rows are editable; core values are filtered out entirely.
  const working: Draft[] = useMemo(() => {
    if (rows) return rows
    return (data?.items ?? [])
      .filter(i => i.section === 'job_role')
      .map(i => ({ ...i, _key: i.id }))
  }, [rows, data])

  const jobTotal = working.reduce((a, b) => a + (Number(b.weightage) || 0), 0)
  /**
   * A penalty row that cannot change a score in either direction,
   * whatever happens all year.
   *
   * Two are live today and neither owner knows — both "PR Cancellation",
   * both worth 0%, one with no target and one with no % to take off. The
   * row looks configured, carries a rule with "can go negative" in its
   * name, and has never moved a total. Each is one field away from
   * working, so it is worth stopping for rather than mentioning.
   */
  const inert = working
    .filter(r => r.scoring_rule === 'lower_linear')
    .map(r => ({
      row: r,
      why: r.target_value === null
        // No target means no allowance to be over, so nothing ever fires.
        ? 'has no target, so nothing is ever over it'
        : Number(r.weightage) === 0 && !(Number(r.rule_params.penalty_per_unit) > 0)
          ? 'is worth 0% and takes nothing off'
          : null,
    }))
    .filter((x): x is { row: Draft; why: string } => x.why !== null)
  const valid =
    jobTotal === JOB_ROLE_TOTAL &&
    working.length > 0 &&
    working.every(r => r.kra.trim() !== '') &&
    inert.length === 0

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
      const id = await saveRows.mutateAsync({
        employeeId: employee.id,
        fy,
        existingAssignmentId: assignment?.id ?? null,
        sourceTemplateId: roleTemplate?.template?.id ?? null,
        esms,
        // Carried into the insert so a brand-new assignment is never
        // saved without one, not even for the moment between this call
        // and the next.
        startsFrom: startMonth,
        rows: working.map(({ _key, _inferred, ...r }, idx) => {
          void _key; void _inferred
          return { ...r, sort_order: idx + 1 }
        }),
      })
      // After the rows, because it needs the assignment the first save
      // creates. Validation refuses to submit without it, so a draft
      // saved here is already answerable.
      await setStart.mutateAsync({ assignmentId: id, month: startMonth })
      return id
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
      return null
    }
  }

  const onSaveDraft = async () => {
    const id = await persist()
    if (id) {
      setNotice('Saved as a draft. Nothing has been sent to your manager yet.')
      // Back to reading from the saved assignment, all three of them, so
      // what is on screen is what is in the database.
      setRows(null); setEsmsChoice(null); setStartChoice(null)
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

  const busy = saveRows.isPending || action.isPending || setStart.isPending

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
          {/* Asked before the rows, because it decides which months the
              rows are ever asked about. A June joiner who leaves this at
              April spends the year with two blanks on their record and
              two rows on their manager's chase list. */}
          <div className="card p-4">
            <label
              htmlFor="kpi-start-month"
              className="block text-sm font-semibold text-ink-800"
            >
              This KPI starts from
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StartMonthSelect
                id="kpi-start-month"
                fy={fy}
                value={startMonth}
                onChange={setStartChoice}
              />
              {skippedMonths > 0 && (
                <span className="badge bg-amber-100 text-amber-800">
                  {skippedMonths} earlier month{skippedMonths === 1 ? '' : 's'} not assessed
                </span>
              )}
            </div>
            <StartMonthNote />
          </div>

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
              {working.map((row, i) => (
                <RowEditor
                  key={row._key}
                  row={row}
                  index={i + 1}
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
                {inert.map(({ row, why }) => (
                  <li key={row._key}>
                    “{row.kra.trim() || 'Untitled row'}” {why}, so it cannot change
                    your score whatever happens. Set a target and how much each one
                    over it should cost, or remove the row.
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="sticky bottom-16 flex flex-wrap gap-2 lg:bottom-0">
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
  row, index, rules, onChange, onRemove,
}: {
  row: Draft
  /** Its place in the list, 1-based. Shown so a row can be referred to. */
  index: number
  rules: ScoringRuleMeta[]
  onChange: (patch: Partial<Draft>) => void
  onRemove: () => void
}) {
  const ruleMeta = rules.find(r => r.code === row.scoring_rule)

  return (
    <div className={`p-4 ${row._inferred ? 'bg-amber-50/60' : ''}`}>
      {/*
        The KRA and its KPI are what this row IS; the weightage, target and
        scoring rule are how it is measured. They were laid out as six
        equal fields with six identical grey labels, so the two that name
        the row read no louder than the two that number it -- and people
        scanning for "where do I write the KRA" had to read every label to
        find out.

        A number, because a form of eight rows is discussed out loud:
        "row three is wrong" needs a row three.
      */}
      <div className="mb-3 flex items-start gap-3">
        <span
          className="mt-6 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-800 text-xs font-semibold text-white"
          aria-hidden
        >
          {index}
        </span>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
              KRA <span className="font-normal normal-case tracking-normal text-ink-400">— the area</span>
            </label>
            <input
              className="input font-medium"
              value={row.kra}
              onChange={e => onChange({ kra: e.target.value })}
              placeholder="e.g. Response time"
              aria-label={`KRA for row ${index}`}
            />
          </div>

          <div className="sm:col-span-8">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
              KPI <span className="font-normal normal-case tracking-normal text-ink-400">— the measurable parameter</span>
            </label>
            <input
              className="input font-medium"
              value={row.kpi_description ?? ''}
              onChange={e => onChange({ kpi_description: e.target.value })}
              placeholder="e.g. BD calls assigned to be attended within 48 hours"
              aria-label={`KPI for row ${index}`}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-12 sm:pl-9">

        {/* The same treatment as the KRA and KPI above. These two are the
            other half of what a row says -- how much it is worth and what
            counts as hitting it -- and they were the plain grey labels the
            pair above used to be. */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
            Weightage <span className="font-normal normal-case tracking-normal text-ink-400">— % of 100</span>
          </label>
          <NumberInput
            min={0} max={100} step="any"
            className="input font-medium"
            value={row.weightage}
            onValue={v => onChange({ weightage: v ?? 0 })}
            aria-label={`Weightage for row ${index}`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-label text-ink-700">
            Target <span className="font-normal normal-case tracking-normal text-ink-400">— to hit</span>
          </label>
          <NumberInput
            step="any"
            className="input font-medium"
            value={row.target_value}
            onValue={v => onChange({ target_value: v })}
            aria-label={`Target for row ${index}`}
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
              {/* What it can do to a score: past the weightage, stopped
                  at it, or below zero and into the total. */}
              <RuleTraits
                rule={row.scoring_rule}
                weightage={row.weightage}
                params={row.rule_params}
              />
              {row._inferred && (
                <span className="font-semibold text-amber-800">
                  guessed — please check
                </span>
              )}
            </label>
            <select
              className="input bg-surface"
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
                    // A "% off the total per one over" belongs to this
                    // rule alone. Carried onto any other it is dead
                    // weight that the marks would still be reading.
                    penalty_per_unit:
                      rule === 'lower_linear' ? row.rule_params.penalty_per_unit : undefined,
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

            {/* The figure that lets a row with no weightage of its own
                still count for something. Offered by both lower rules:
                what a unit over costs and where the score bottoms out are
                two separate decisions, and tying them together meant
                picking the floor you wanted and accepting whatever
                penalty came with it. */}
            {(row.scoring_rule === 'lower_linear' || row.scoring_rule === 'lower_penalty') && (
              <PenaltyPerUnit
                weightage={row.weightage}
                value={row.rule_params.penalty_per_unit ?? null}
                onValue={v => onChange({
                  rule_params: {
                    ...row.rule_params,
                    penalty_per_unit: v ?? undefined,
                  },
                })}
              />
            )}

            {/* Only once the row has a target. Before that there is
                nothing to compute, and a tester showing a dash while
                somebody is still typing the KRA is a row taller for no
                reason.

                The weightage is deliberately not part of the test. A
                penalty row is worth 0% on purpose, and that is precisely
                the row nobody believes until they watch it take 4% off. */}
            {row.target_value !== null && (
              <RuleTester
                weightage={row.weightage}
                target={row.target_value}
                rule={row.scoring_rule}
                params={row.rule_params}
              />
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
 * How much a row takes off the total for each one over the target.
 *
 * The rule's other setting is a proportional slice of the weightage,
 * which is a share of nothing on a row deliberately worth 0% — and worth
 * 0% is the whole point of a row like "monthly maximum one complaint".
 * It is not a share of the 80%; it exists to take something away when
 * the thing happens. So the amount is asked for in points off the total,
 * which is the number the person actually sees at the end of the month.
 */
function PenaltyPerUnit({
  weightage, value, onValue,
}: {
  weightage: number
  value: number | null
  onValue: (v: number | null) => void
}) {
  const id = `penalty-${useId()}`
  // Nought per cent off is not a small penalty, it is no penalty — the
  // row would carry a rule that can never fire. So it counts as unset
  // everywhere: here, in the marks, and in the engine.
  const idle = !(Number(value) > 0)

  return (
    <div className="mt-2.5 border-t border-ink-200/70 pt-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-600">
        <TrendingDown className="h-3.5 w-3.5 shrink-0 text-cyrixRed-500" />
        <label htmlFor={id}>Each one over the target takes</label>
        <span className="relative">
          <NumberInput
            id={id}
            min={1} step="any"
            className="input w-24 py-1 pr-6 text-xs"
            value={value}
            onValue={onValue}
            placeholder="2"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400">
            %
          </span>
        </span>
        <span>off my total</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
        {weightage === 0
          ? idle
            // The state the two live penalty rows are in, and the reason
            // neither has ever moved a total.
            ? 'This row is worth 0%, so this figure is the only thing it can do. Without it the row scores nothing whatever happens.'
            : 'Staying within the target costs nothing. This row earns no marks of its own — it only takes them off when the target is passed.'
          : idle
            ? `Leave this blank to take a proportional slice off this row's own ${weightage}% instead.`
            : `Taken off the whole score, not only this row's ${weightage}%.`}
      </p>
    </div>
  )
}

/**
 * Type a number, see what it does.
 *
 * The description under the picker carries a worked example, but it uses
 * a target of 2 and a weightage of 10, which are not this person's — so
 * the one thing it cannot answer is "what does this rule do to MY row".
 * This runs the same calc_kpi_score the database will run, against the
 * target and weightage actually on the row, so agreeing to a rule and
 * understanding it become the same moment.
 *
 * One line, and only where a target exists. Nothing is saved: it is a
 * calculator, not a field.
 */
function RuleTester({
  weightage, target, rule, params,
}: {
  weightage: number
  target: number
  rule: ScoringRule
  params: RuleParams
}) {
  const [tried, setTried] = useState('')
  const achieved = tried.trim() === '' ? null : Number(tried)
  const score = achieved === null || Number.isNaN(achieved)
    ? null
    : calcKpiScore(rule, weightage, target, achieved, params)
  const band = score === null ? null : bandFor(attainmentPct(score, weightage))

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-200/70 pt-2.5 text-xs text-ink-600">
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      <span>Try it — if I achieve</span>
      <input
        type="number" inputMode="decimal" step="any"
        className="input w-24 py-1 text-xs"
        value={tried}
        onChange={e => setTried(cleanNumberText(e.target.value))}
        placeholder={String(target)}
        aria-label="A figure to try against this rule"
      />
      <span>against a target of {target},</span>
      {score === null ? (
        <span className="text-ink-300">—</span>
      ) : weightage === 0 ? (
        /*
          A row worth nothing cannot score, so "0.00 of 0" is true and
          useless. What it can do is cost, and that is the sentence: the
          figure people are trying to picture is the one that comes off
          the 90 they were expecting.
        */
        score < 0 ? (
          <span className="font-semibold tabular-nums text-cyrixRed-700">
            {(-score).toFixed(2)}% comes off my total
          </span>
        ) : (
          <span className="font-semibold text-emerald-700">nothing comes off my total</span>
        )
      ) : (
        <span className={clsx('font-semibold tabular-nums', band?.accent)}>
          I score {score.toFixed(2)}{' '}
          <span className="font-normal text-ink-400">of {weightage}</span>
        </span>
      )}
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
    <div className="rounded-lg border border-ink-200 bg-surface p-3">
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
          <NumberInput
            step="any"
            value={alt.target_value}
            onValue={v => onChange({ target_value: v })}
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
