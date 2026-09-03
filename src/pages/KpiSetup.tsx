import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Upload, FileSpreadsheet, Plus, ArrowLeft, Send, Save, Lock, X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyAssignment, useSaveAssignmentRows, useAssignmentAction, useSetKpiStart,
  useScoringRules, useVisibleTemplates, useTemplateItems, useCoreValues, currentFy,
} from '@/lib/queries'
import { defaultStartMonth, fyMonths } from '@/lib/fy'
import { StartMonthSelect, StartMonthNote } from '@/components/StartMonth'
import RowEditor, { blankRow, type Draft } from '@/components/KpiRowEditor'
import type { ParseResult } from '@/lib/excel'
import type { VisibleTemplate } from '@/types/db'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL, ESMS_WEIGHT } from '@/lib/sections'
import { Alert, PageLoader, Spinner } from '@/components/ui'

/**
 * Team members define their Job Role rows only. The remaining 20% is
 * standard — core values for everyone, and for the people who carry an
 * ESMS obligation, 5% of that 20% moves to ESMS. Both are attached by
 * the system, so they are shown here for reference and are not editable.
 */

export default function KpiSetup() {
  const { employee } = useAuth()
  const navigate = useNavigate()
  const fy = currentFy()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useMyAssignment(employee?.id, fy)
  const { data: rules } = useScoringRules()
  const { data: coreValues } = useCoreValues()
  // Everything this person's own reporting line has agreed, plus HR's for
  // their job role. Until migration 0093 the card below could only ever
  // offer the second, which for all but one job role was nothing at all.
  const { data: templates } = useVisibleTemplates(fy)
  const templateIds = useMemo(() => (templates ?? []).map(t => t.id), [templates])
  const { data: templateItems } = useTemplateItems(templateIds)
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
  /** Which template these rows came from, for the record on the assignment. */
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null)
  /** True while the list of templates is open. */
  const [picking, setPicking] = useState(false)

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

  const loadTemplate = (tpl: VisibleTemplate) => {
    const jobRows = (templateItems?.get(tpl.id) ?? []).filter(i => i.section === 'job_role')
    if (jobRows.length === 0) return
    setParseInfo(null)
    setPicking(false)
    setSourceTemplateId(tpl.id)
    setRows(jobRows.map((i, idx) => ({
      _key: crypto.randomUUID(),
      section: 'job_role' as const,
      kra: i.kra, kpi_description: i.kpi_description,
      weightage: Number(i.weightage), target_value: i.target_value, target_unit: i.target_unit,
      scoring_rule: i.scoring_rule, rule_params: i.rule_params, sort_order: idx + 1,
      // Fresh ids. The alternate id is what a monthly submission points at
      // when somebody picks one, and two people whose KPIs came from the
      // same template must not be pointing at the same row.
      alternates: (i.alternates ?? []).map(a => ({
        ...a,
        id: `alt-${crypto.randomUUID().slice(0, 8)}`,
      })),
    })))
    const alts = jobRows.reduce((a, i) => a + (i.alternates ?? []).length, 0)
    setNotice(
      `Loaded “${tpl.name}”${tpl.is_company ? '' : ` — ${tpl.owner_name}'s template`}. ` +
      (alts > 0
        ? `${alts} alternative${alts === 1 ? '' : 's'} came along too — rows that measure ` +
          'something else in some months. '
        : '') +
      'The targets came along as a starting point; change anything that is not right for you.',
    )
  }

  const persist = async () => {
    if (!employee) return null
    setError(null)
    try {
      const id = await saveRows.mutateAsync({
        employeeId: employee.id,
        fy,
        existingAssignmentId: assignment?.id ?? null,
        // What these rows actually came from, rather than whatever
        // template happened to exist for the job role — which is what
        // this recorded before, including on a KPI typed from scratch.
        sourceTemplateId,
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

          {/* Was a dead card for everyone but one job role: it read HR's
              templates alone, and only one has ever existed. It now
              offers whatever this person's own reporting line keeps, so
              for most people it is the fastest way in rather than the
              greyed-out middle option. */}
          <button
            onClick={() => setPicking(v => !v)}
            disabled={(templates ?? []).length === 0}
            aria-expanded={picking}
            className="card card-interactive flex flex-col items-center gap-2 p-6 text-center disabled:opacity-50"
          >
            <FileSpreadsheet className="h-7 w-7 text-ink-500" />
            <p className="font-medium text-ink-900">Use a team template</p>
            <p className="text-xs text-ink-500">
              {(templates ?? []).length === 0
                ? 'Your manager has not saved one yet'
                : `${templates!.length} to choose from`}
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

      {/*
        The list, under the three cards rather than inside the middle one.

        A native <select> was the obvious answer and the wrong one: two
        managers in a division both keeping an "Engineer" is normal, so
        the name alone cannot identify a template — who keeps it and how
        many rows it has are part of choosing, and none of that fits in
        an option.
      */}
      {picking && working.length === 0 && (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">
              Templates you can start from
            </h3>
            <button onClick={() => setPicking(false)} className="btn-icon" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {(templates ?? []).map(t => (
            <button
              key={t.id}
              onClick={() => loadTemplate(t)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-violet-600" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900">{t.name}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-500">
                  {t.item_count} row{Number(t.item_count) === 1 ? '' : 's'}
                  {t.is_company
                    ? ' · company standard for your job role'
                    : ` · kept by ${t.owner_name ?? 'a manager'}${t.owner_ecode ? ` (${t.owner_ecode})` : ''}`}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-ink-900">Use this</span>
            </button>
          ))}
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

