import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Download, RotateCcw } from 'lucide-react'
import {
  useKpiReport, useReportFilterTree, currentFy, type ReportDim,
} from '@/lib/queries'
import { fyMonths, monthLabel } from '@/lib/fy'
import { exportOrgStatus } from '@/lib/export'
import { bandFor } from '@/lib/bands'
import { Spinner, Alert } from '@/components/ui'

/** Year to date rather than a single month. */
const YTD = 'ytd'

const DIMS: Array<{ key: ReportDim; label: string }> = [
  { key: 'function', label: 'Function' },
  { key: 'department', label: 'Department' },
  { key: 'manager', label: 'Manager' },
]

/**
 * The HR report.
 *
 * Completion by month, completion by manager and turnaround used to be
 * three tabs. They were three answers to one question that happened to be
 * built on different days — same population, same period, different
 * grouping — so this is one table whose shape is chosen rather than three
 * tables to click between.
 *
 * Two controls do that work. The tick boxes decide which dimensions the
 * numbers are summed over, and a dimension that is not ticked loses its
 * column. The filters narrow the population, and they cascade: pick a
 * function and only its departments remain on offer.
 */
export default function KpiReport() {
  const fy = currentFy()
  const months = useMemo(() => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    // Up to and including the current month — a report on next February
    // is a row of zeroes pretending to be an outstanding item.
    return fyMonths(fy).filter(m => m <= thisMonth)
  }, [fy])

  const [month, setMonth] = useState<string>(YTD)
  const [fn, setFn] = useState<string | null>(null)
  const [dept, setDept] = useState<string | null>(null)
  const [managerId, setManagerId] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<ReportDim[]>(['function', 'department', 'manager'])

  const { data: tree } = useReportFilterTree(fy, months[0] ?? '', true)

  // Each level offers only what survives the level above it, so a
  // combination that would return an empty table cannot be selected.
  const functions = useMemo(
    () => [...new Set((tree ?? []).map(r => r.function_name))].sort(),
    [tree],
  )
  const departments = useMemo(
    () => [...new Set((tree ?? [])
      .filter(r => !fn || r.function_name === fn)
      .map(r => r.department))].sort(),
    [tree, fn],
  )
  const managers = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>()
    for (const r of tree ?? []) {
      if (fn && r.function_name !== fn) continue
      if (dept && r.department !== dept) continue
      if (!seen.has(r.manager_id)) {
        seen.set(r.manager_id, {
          id: r.manager_id, label: `${r.manager_name} · ${r.manager_ecode}`,
        })
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [tree, fn, dept])

  const { data: rows, isFetching, error } = useKpiReport(fy, {
    month: month === YTD ? null : month,
    fn, department: dept, managerId, groupBy,
  })

  const toggle = (dim: ReportDim) =>
    setGroupBy(prev =>
      prev.includes(dim)
        ? prev.filter(d => d !== dim)
        // Kept in DIMS order so the columns cannot end up shuffled by the
        // order somebody happened to tick them.
        : DIMS.map(d => d.key).filter(k => k === dim || prev.includes(k)),
    )

  const reset = () => {
    setMonth(YTD); setFn(null); setDept(null); setManagerId(null)
    setGroupBy(['function', 'department', 'manager'])
  }

  const periodLabel = month === YTD
    ? `Apr–${monthLabel(months[months.length - 1] ?? '')}`
    : monthLabel(month)

  /** Exactly what is on screen, in the order it is on screen. */
  const download = () => {
    const out = (rows ?? []).map(r => {
      const line: Record<string, string | number> = { Period: periodLabel }
      if (groupBy.includes('function')) line.Function = r.function_name ?? ''
      if (groupBy.includes('department')) line.Department = r.department ?? ''
      if (groupBy.includes('manager')) {
        line.Manager = r.manager_name ?? ''
        line['Manager code'] = r.manager_ecode ?? ''
      }
      line.Team = r.team
      line.Scored = r.scored
      line['To score'] = r.to_score
      line['Not submitted'] = r.not_submitted
      line['Scored %'] = r.scored_pct ?? ''
      line.Average = r.avg_score ?? ''
      line['TM TAT (days)'] = r.tm_tat ?? ''
      line['RM TAT (days)'] = r.rm_tat ?? ''
      return line
    })
    const scope = [
      fn, dept,
      managerId ? managers.find(m => m.id === managerId)?.label.split(' · ')[0] : null,
    ].filter(Boolean).join('-')
    exportOrgStatus(
      out,
      `Cyrix-KPI-report-${periodLabel}${scope ? `-${scope}` : ''}.xlsx`.replace(/\s+/g, ''),
      'KPI report',
    )
  }

  const totals = useMemo(() => {
    const r = rows ?? []
    const sum = (k: 'team' | 'scored' | 'to_score' | 'not_submitted') =>
      r.reduce((a, x) => a + Number(x[k] ?? 0), 0)
    const team = sum('team')
    return {
      team, scored: sum('scored'), toScore: sum('to_score'),
      notIn: sum('not_submitted'),
      pct: team ? Math.round((sum('scored') / team) * 1000) / 10 : 0,
    }
  }, [rows])

  const select = 'input w-auto min-w-40'

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{(error as Error).message}</Alert>}

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink-900">KPI report · {periodLabel}</h3>
            <p className="mt-1 text-sm text-ink-500">
              {month === YTD
                ? 'Every month of the year so far, added together.'
                : 'One month.'}{' '}
              Active employees who have a reporting manager.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={reset} className="btn-secondary" title="Clear all filters">
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
            <button onClick={download} className="btn-excel" disabled={!rows?.length}>
              <Download className="h-4 w-4" /> Export to Excel
            </button>
          </div>
        </div>

        {/* ---- period + cascading filters ---- */}
        <div className="flex flex-wrap items-end gap-3">
          <Labelled label="Period">
            <select className={select} value={month} onChange={e => setMonth(e.target.value)}>
              <option value={YTD}>
                Till date · Apr–{monthLabel(months[months.length - 1] ?? '')}
              </option>
              {[...months].reverse().map(m => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </Labelled>

          <Labelled label="Function">
            <select
              className={select}
              value={fn ?? ''}
              onChange={e => {
                setFn(e.target.value || null)
                setDept(null); setManagerId(null)
              }}
            >
              <option value="">All functions</option>
              {functions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Labelled>

          <Labelled label="Department">
            <select
              className={select}
              value={dept ?? ''}
              onChange={e => { setDept(e.target.value || null); setManagerId(null) }}
            >
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Labelled>

          <Labelled label="Manager">
            <select
              className={select}
              value={managerId ?? ''}
              onChange={e => setManagerId(e.target.value || null)}
            >
              <option value="">All managers</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Labelled>
        </div>

        {/* ---- what the numbers are summed over ---- */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-100 pt-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-label text-ink-500">
            Summarise by
          </span>
          {DIMS.map(d => (
            <label
              key={d.key}
              className="flex cursor-pointer items-center gap-2 text-sm text-ink-700"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-ink-300"
                checked={groupBy.includes(d.key)}
                onChange={() => toggle(d.key)}
              />
              {d.label}
            </label>
          ))}
          {groupBy.length === 0 && (
            <span className="text-xs text-cyrixRed-700">Pick at least one.</span>
          )}
          {isFetching && <Spinner className="h-4 w-4 text-ink-400" />}
        </div>
      </div>

      {/* ---- totals for whatever is currently selected ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label={month === YTD ? 'Person-months' : 'People'}
          value={totals.team}
          sub={month === YTD ? 'across the months so far' : 'in scope'}
        />
        <Tile label="Scored" value={totals.scored} sub="manager has scored"
              cls="text-emerald-700" />
        <Tile label="To score" value={totals.toScore} sub="submitted, waiting"
              cls={totals.toScore ? 'text-amber-700' : undefined} />
        <Tile label="Not submitted" value={totals.notIn} sub="nothing from the TM"
              cls={totals.notIn ? 'text-cyrixRed-700' : undefined} />
        <Tile label="Completion" value={`${totals.pct}%`} sub="of what was due" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                {groupBy.includes('function') && <th className="px-4 py-2.5">Function</th>}
                {groupBy.includes('department') && <th className="px-4 py-2.5">Department</th>}
                {groupBy.includes('manager') && <th className="px-4 py-2.5">Manager</th>}
                <th className="px-4 py-2.5 min-w-28">Progress</th>
                <th className="px-4 py-2.5 text-right">Team</th>
                <th className="px-4 py-2.5 text-right">Scored</th>
                <th className="px-4 py-2.5 text-right">To score</th>
                <th className="px-4 py-2.5 text-right">Not in</th>
                <th className="px-4 py-2.5 text-right">Scored %</th>
                <th className="px-4 py-2.5 text-right">Average</th>
                <th className="px-4 py-2.5 text-right" title="Days from the 1st of the following month to the team member submitting">
                  TM TAT
                </th>
                <th className="px-4 py-2.5 text-right" title="Days from the 1st of the following month to the manager scoring">
                  RM TAT
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {(rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-sm text-ink-500">
                    {isFetching ? 'Loading…' : 'Nothing matches those filters.'}
                  </td>
                </tr>
              ) : (
                (rows ?? []).map((r, i) => {
                  const band = bandFor(r.avg_score)
                  const pct = Number(r.scored_pct ?? 0)
                  return (
                    <tr
                      key={`${r.function_name}-${r.department}-${r.manager_id}-${i}`}
                      className="hover:bg-ink-50"
                    >
                      {groupBy.includes('function') && (
                        <td className="px-4 py-3 font-medium text-ink-900">{r.function_name}</td>
                      )}
                      {groupBy.includes('department') && (
                        <td className="px-4 py-3 text-ink-700">{r.department}</td>
                      )}
                      {groupBy.includes('manager') && (
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink-900">{r.manager_name}</p>
                          <p className="text-xs text-ink-500">{r.manager_ecode}</p>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <Num v={r.team} />
                      <Num v={r.scored} cls={r.scored ? 'text-emerald-700' : undefined} />
                      <Num v={r.to_score} cls={r.to_score ? 'text-amber-700' : undefined} />
                      <Num v={r.not_submitted} cls={r.not_submitted ? 'text-ink-500' : undefined} />
                      <td className="px-4 py-3 text-right tabular-nums text-ink-700">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.avg_score === null ? (
                          <span className="text-ink-300">—</span>
                        ) : (
                          <span className={clsx('font-semibold tabular-nums', band?.accent)}>
                            {Number(r.avg_score).toFixed(1)}
                          </span>
                        )}
                      </td>
                      <Num v={r.tm_tat} dash />
                      <Num v={r.rm_tat} dash />
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-400">
        Turnaround counts days from the 1st of the month after the KPI month,
        including the day it was submitted — July's KPI submitted on 5 August
        is 5 days.
      </p>
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      {children}
    </div>
  )
}

function Num({ v, cls, dash }: { v: number | null; cls?: string; dash?: boolean }) {
  const empty = v === null || v === undefined || (dash && Number.isNaN(Number(v)))
  return (
    <td className={clsx('px-4 py-3 text-right tabular-nums', cls ?? 'text-ink-700')}>
      {empty ? <span className="text-ink-300">—</span> : Number(v).toLocaleString()}
    </td>
  )
}

function Tile({
  label, value, sub, cls,
}: {
  label: string; value: string | number; sub: string; cls?: string
}) {
  return (
    <div className="card p-4">
      <p className="label !mb-0">{label}</p>
      <p className={clsx('mt-2 text-2xl font-semibold tabular-nums',
        cls ?? 'text-ink-900')}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className="mt-0.5 text-xs text-ink-400">{sub}</p>
    </div>
  )
}
