import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Upload, Download, Users, FileSpreadsheet, Info, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Alert, Spinner } from '@/components/ui'
import { currentFy } from '@/lib/queries'
import { JOB_ROLE_TOTAL } from '@/lib/sections'
import {
  planBulkUpload, applyBulkUpload, downloadBulkResult, downloadBulkTemplate,
  type BulkPlan, type BulkOutcome,
} from '@/lib/bulkKpi'

/* ---------------------------------------------------------------------
 * Spare · bulk KPI assignment
 *
 * A divisional manager with two hundred reports on the same job cannot
 * be asked to approve the same eight rows two hundred times, and they
 * cannot each be asked to type them. One workbook does both: a Template
 * sheet with the rows, an Ecode sheet with the people.
 *
 * Two steps on purpose. Reading the file says what was understood;
 * applying it writes to two hundred records, and a file misread is not
 * something to find out about afterwards.
 * ------------------------------------------------------------------- */

export default function BulkKpi() {
  const fy = currentFy()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [plan, setPlan] = useState<BulkPlan | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null)

  async function onFile(file: File) {
    setReadError(null); setPlan(null); setOutcomes(null); setProgress(null)
    setFileName(file.name)
    try {
      setPlan(planBulkUpload(await file.arrayBuffer()))
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  async function apply() {
    if (!plan) return
    setBusy(true)
    setProgress({ done: 0, total: plan.ecodes.length })
    const result = await applyBulkUpload(plan, fy, (done, total) => setProgress({ done, total }))
    setOutcomes(result)
    setBusy(false)
    // Handed over without being asked for. Two hundred outcomes is not
    // something to read off a screen and remember, and the one moment
    // somebody definitely still cares is the moment it finishes.
    downloadBulkResult(result, fy)
  }

  const jobRows = plan?.parsed.rows.filter(r => r.section === 'job_role') ?? []
  const jobTotal = Math.round(jobRows.reduce((a, r) => a + r.weightage, 0) * 10) / 10
  const canApply = !!plan && plan.errors.length === 0 && plan.ecodes.length > 0

  const tally = (s: BulkOutcome['status']) => outcomes?.filter(o => o.status === s).length ?? 0

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-ink-900">Bulk KPI assignment</h3>
        <p className="mt-0.5 text-sm text-ink-500">
          One set of KRAs, applied to everybody listed in the file. FY {fy}.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div>
          <p className="font-medium text-ink-900">These arrive approved</p>
          <p className="mt-1">
            Rows uploaded here are active immediately — no manager approval, because the
            manager is who this is being done on behalf of. Somebody who already has KPIs
            for {fy} has them <strong className="font-medium text-ink-900">replaced</strong>.
            Anyone with a month already scored is skipped, so a score already given keeps
            meaning what it meant.
          </p>
        </div>
      </div>

      {readError && <Alert kind="error">{readError}</Alert>}

      <div className="card space-y-3 p-4">
        {/* Handed the file rather than told about it: every rule on this
            screen is a rule about a workbook somebody has to produce, and
            the surest way to get the right one back is to give it out. */}
        <button type="button" onClick={downloadBulkTemplate} className="btn-secondary w-full sm:w-auto">
          <Download className="h-4 w-4" /> Download the blank template
        </button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 px-3 py-5 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {fileName ?? 'Choose the KPI template workbook'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <p className="text-xs text-ink-500">
          Two sheets: <strong className="font-medium text-ink-700">Template</strong> with the KRA
          rows, and <strong className="font-medium text-ink-700">Ecode</strong> listing who gets
          them. Weightages as percentages — 40% or 40 — totalling {JOB_ROLE_TOTAL}% across Job Role.
        </p>
      </div>

      {/* What was understood, before anything is written. The totals are
          the part worth checking: a sheet read in the wrong units is
          arithmetically fine and completely wrong. */}
      {plan && (
        <>
          {plan.errors.map((e, i) => <Alert key={i} kind="error">{e}</Alert>)}
          {plan.warnings.map((w, i) => <Alert key={i} kind="warning">{w}</Alert>)}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat icon={FileSpreadsheet} label="KRA rows" value={String(jobRows.length)} />
            <Stat
              icon={CheckCircle2}
              label="Job Role total"
              value={`${jobTotal}%`}
              bad={jobTotal !== JOB_ROLE_TOTAL}
            />
            <Stat icon={Users} label="People" value={String(plan.ecodes.length)} />
          </div>

          {jobRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
                  <tr>
                    <th className="px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5">KRA</th>
                    <th className="px-3 py-2.5">KPI</th>
                    <th className="px-3 py-2.5 text-right">Weightage</th>
                    <th className="px-3 py-2.5 text-right">Target</th>
                    <th className="px-3 py-2.5">Scored</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {jobRows.map((r, i) => (
                    <tr key={r.sourceRow}>
                      <td className="px-3 py-2.5 text-ink-400">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-ink-900">{r.kra}</td>
                      <td className="max-w-md px-3 py-2.5 text-ink-600">
                        <span className="line-clamp-2">{r.kpi_description ?? '—'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{r.weightage}%</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-600">
                        {r.target_value ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-500">
                        {r.scoring_rule.replace(/_/g, ' ')}
                        {r.rule_params.penalty_per_unit != null && (
                          <span className="ml-1 text-cyrixRed-700">
                            −{r.rule_params.penalty_per_unit}% per unit
                          </span>
                        )}
                        {/* Said plainly: a guessed rule is the one thing on
                            this page that is not in the file. */}
                        {r.rule_inferred && (
                          <span className="ml-1 text-amber-700">(guessed)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan.ecodes.length > 0 && (
            <p className="text-xs text-ink-500">
              <strong className="font-medium text-ink-700">Applying to:</strong>{' '}
              {plan.ecodes.slice(0, 25).join(', ')}
              {plan.ecodes.length > 25 && ` … and ${plan.ecodes.length - 25} more`}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button onClick={apply} disabled={!canApply || busy} className="btn-primary">
              {busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
              {busy && progress
                ? `Assigning ${progress.done}/${progress.total}…`
                : `Assign to ${plan.ecodes.length} ${plan.ecodes.length === 1 ? 'person' : 'people'}`}
            </button>
            {!canApply && plan.errors.length > 0 && (
              <span className="text-xs text-ink-500">Fix the file and choose it again.</span>
            )}
          </div>
        </>
      )}

      {outcomes && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat icon={CheckCircle2} label="Created" value={String(tally('Created'))} />
            <Stat icon={CheckCircle2} label="Replaced" value={String(tally('Replaced'))} />
            <Stat icon={AlertTriangle} label="Skipped" value={String(tally('Skipped'))} bad={tally('Skipped') > 0} />
            <Stat icon={AlertTriangle} label="Failed" value={String(tally('Failed'))} bad={tally('Failed') > 0} />
          </div>

          <button
            onClick={() => downloadBulkResult(outcomes, fy)}
            className="btn-secondary"
          >
            <Download className="h-4 w-4" /> Download the result again
          </button>

          <div className="overflow-x-auto rounded-xl border border-ink-200">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
                <tr>
                  <th className="px-3 py-2.5">Code</th>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Result</th>
                  <th className="px-3 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {outcomes.map(o => (
                  <tr key={o.ecode} className={clsx(o.status === 'Failed' && 'bg-cyrixRed-50/50')}>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-600">{o.ecode}</td>
                    <td className="px-3 py-2.5 text-ink-900">{o.name}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx(
                        'badge',
                        o.status === 'Created' && 'bg-emerald-100 text-emerald-800',
                        o.status === 'Replaced' && 'bg-violet-100 text-violet-800',
                        o.status === 'Skipped' && 'bg-amber-100 text-amber-800',
                        o.status === 'Failed' && 'bg-cyrixRed-100 text-cyrixRed-800',
                      )}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-600">{o.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  icon: Icon, label, value, bad,
}: {
  icon: typeof Users; label: string; value: string; bad?: boolean
}) {
  return (
    <div className={clsx(
      'card flex items-center gap-3 p-3',
      bad && 'border-amber-300 bg-amber-50',
    )}>
      <Icon className={clsx('h-4 w-4 shrink-0', bad ? 'text-amber-600' : 'text-ink-400')} />
      <div className="min-w-0">
        <p className="text-xs text-ink-500">{label}</p>
        <p className={clsx('text-lg font-semibold', bad ? 'text-amber-900' : 'text-ink-900')}>{value}</p>
      </div>
    </div>
  )
}
