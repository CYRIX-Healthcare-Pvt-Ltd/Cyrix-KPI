import { useState, useMemo } from 'react'
import { Download, Clock, Users2, CalendarRange } from 'lucide-react'
import {
  useOrgKpiStatus, useManagerCompletion, useManagerTat,
  useManagerMonthStatus, currentFy,
} from '@/lib/queries'
import { supabase, friendlyError } from '@/lib/supabase'
import { exportKpiScores, exportOrgStatus } from '@/lib/export'
import { openFyMonths, monthLabel, currentReportingMonth } from '@/lib/fy'
import { PageLoader, ScorePill, StatTile, Alert, Spinner } from '@/components/ui'
import {
  MonthStatusTable, MonthStatusSummary, MonthStatusLegend,
} from '@/components/MonthStatus'
import type { Employee } from '@/types/db'

type Tab = 'month' | 'scores' | 'managers' | 'tat'

export default function AdminReports() {
  const fy = currentFy()
  // Chasing a particular month is the commonest reason to open this page,
  // so it opens there rather than on the export.
  const [tab, setTab] = useState<Tab>('month')
  const [month, setMonth] = useState(currentReportingMonth())
  const [onlyBehind, setOnlyBehind] = useState(false)
  const { data: org, isLoading } = useOrgKpiStatus(true, fy)
  const { data: managers } = useManagerCompletion(true)
  const { data: tat } = useManagerTat(true, fy)
  const { data: monthRows } = useManagerMonthStatus(fy, { month })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deptFilter, setDeptFilter] = useState('all')

  const departments = useMemo(
    () => [...new Set((org ?? []).map(e => e.department).filter(Boolean))].sort() as string[],
    [org],
  )

  const scopedIds = useMemo(() => {
    if (!org) return []
    return org
      .filter(e => deptFilter === 'all' || e.department === deptFilter)
      .map(e => e.employee_id)
  }, [org, deptFilter])

  /**
   * The full month-by-month workbook. Fetched on demand rather than kept
   * in memory — with 1,100 people this is a large query.
   */
  const downloadScores = async () => {
    setBusy(true); setError(null)
    try {
      const people: Employee[] = []
      for (let i = 0; i < scopedIds.length; i += 500) {
        const { data, error: e } = await supabase.from('employees').select('*')
          .in('id', scopedIds.slice(i, i + 500))
        if (e) throw new Error(friendlyError(e))
        people.push(...(data ?? []))
      }

      const subs: Awaited<ReturnType<typeof fetchSubs>> = []
      async function fetchSubs(ids: string[]) {
        const { data, error: e } = await supabase.from('kpi_submissions').select('*')
          .in('employee_id', ids).eq('financial_year', fy)
        if (e) throw new Error(friendlyError(e))
        return data ?? []
      }
      for (let i = 0; i < scopedIds.length; i += 500) {
        subs.push(...(await fetchSubs(scopedIds.slice(i, i + 500))))
      }

      const byEmp = new Map<string, typeof subs>()
      for (const s of subs) {
        const list = byEmp.get(s.employee_id) ?? []
        list.push(s)
        byEmp.set(s.employee_id, list)
      }

      await exportKpiScores(
        people
          .sort((a, b) => a.ecode.localeCompare(b.ecode))
          .map(employee => ({ employee, submissions: byEmp.get(employee.id) ?? [] })),
        fy,
        `Cyrix-KPI-scores-${deptFilter === 'all' ? 'all' : deptFilter}-${fy}.xlsx`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the export.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <PageLoader label="Loading reports…" />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">Reports</h1>
        <p className="mt-0.5 text-sm text-ink-500">FY {fy}</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="flex gap-1 border-b border-ink-200">
        {([
          ['month', 'By month', CalendarRange],
          ['scores', 'Score export', Download],
          ['managers', 'Manager completion', Users2],
          ['tat', 'Turnaround', Clock],
        ] as Array<[Tab, string, React.ComponentType<{ className?: string }>]>).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? 'border-ink-900 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-800'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ),
        )}
      </div>

      {tab === 'month' && (
        <div className="space-y-4">
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink-900">
                  Who has finished {monthLabel(month)}
                </h3>
                <p className="mt-1 text-sm text-ink-500">
                  Every manager with a team, whether or not they have started.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto"
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  aria-label="Month"
                >
                  {openFyMonths(fy).reverse().map(m => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
                <button
                  onClick={() => exportOrgStatus(
                    (monthRows ?? []).filter(r => r.team_size > 0).map(r => ({
                      Month: monthLabel(r.period_month),
                      Manager: r.manager_name,
                      Code: r.manager_ecode,
                      Department: r.department ?? '',
                      'Team size': r.team_size,
                      Scored: r.scored,
                      'Waiting on manager': r.awaiting_manager,
                      Returned: r.returned,
                      'Not submitted': r.not_submitted,
                      'Team average': r.team_avg_score ?? '',
                    })),
                    `Cyrix-KPI-${monthLabel(month)}-status.xlsx`,
                    'Month status',
                  )}
                  className="btn-secondary"
                  disabled={!monthRows?.length}
                >
                  <Download className="h-4 w-4" /> Export
                </button>
              </div>
            </div>

            <MonthStatusSummary
              rows={(monthRows ?? []).filter(r => r.team_size > 0)}
            />
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <MonthStatusLegend />
              <label className="flex items-center gap-2 text-xs font-medium text-ink-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-ink-300"
                  checked={onlyBehind}
                  onChange={e => setOnlyBehind(e.target.checked)}
                />
                Only those with something outstanding
              </label>
            </div>
            <MonthStatusTable
              mode="by-manager"
              rows={(monthRows ?? []).filter(
                r => r.team_size > 0 && (!onlyBehind || r.scored < r.team_size),
              )}
              emptyMessage={
                onlyBehind
                  ? `Every manager has scored their whole team for ${monthLabel(month)}.`
                  : 'No managers with a team yet.'
              }
            />
          </div>
        </div>
      )}

      {tab === 'scores' && (
        <div className="card space-y-4 p-5">
          <div>
            <h3 className="font-semibold text-ink-900">Month-by-month score export</h3>
            <p className="mt-1 text-sm text-ink-500">
              One row per employee: code, name, designation and department, then a merged
              block per month showing Job Role %, Core Value % and Total, with the yearly
              average at the end. Unscored months are left blank rather than counted as zero.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px]">
              <label className="label text-xs">Department</label>
              <select
                className="input"
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
              >
                <option value="all">All departments ({org?.length ?? 0} people)</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <button onClick={downloadScores} className="btn-primary" disabled={busy || scopedIds.length === 0}>
              {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              Download {scopedIds.length} employee(s)
            </button>
          </div>
        </div>
      )}

      {tab === 'managers' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Managers" value={managers?.length ?? 0} />
            <StatTile
              label="Teams fully set up"
              value={(managers ?? []).filter(m => m.kpi_not_set_up === 0).length}
              sub={`of ${managers?.length ?? 0}`}
            />
            <StatTile
              label="People with no KPI"
              value={(managers ?? []).reduce((a, m) => a + m.kpi_not_set_up, 0)}
            />
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
              <h3 className="text-sm font-semibold text-ink-800">Completion by manager</h3>
              <button
                onClick={() => exportOrgStatus(
                  (managers ?? []).map(m => ({
                    Manager: m.manager_name, Ecode: m.manager_ecode,
                    Department: m.department ?? '', 'Team size': m.team_size,
                    Approved: m.kpi_approved, 'Awaiting approval': m.kpi_awaiting_approval,
                    'Not set up': m.kpi_not_set_up,
                    'Months to score': m.months_awaiting_score ?? 0,
                    'Team average': m.team_avg_score ?? '',
                  })),
                  `Cyrix-manager-completion-${fy}.xlsx`, 'Manager completion',
                )}
                className="link-accent text-xs hover:underline"
              >
                Export
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2.5 font-medium">Manager</th>
                    <th className="px-4 py-2.5 text-right font-medium">Team</th>
                    <th className="px-4 py-2.5 text-right font-medium">Approved</th>
                    <th className="px-4 py-2.5 text-right font-medium">Pending</th>
                    <th className="px-4 py-2.5 text-right font-medium">Not set up</th>
                    <th className="px-4 py-2.5 text-right font-medium">To score</th>
                    <th className="px-4 py-2.5 text-right font-medium">Team avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {(managers ?? []).map(m => (
                    <tr key={m.manager_id} className="hover:bg-ink-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink-900">{m.manager_name}</p>
                        <p className="text-xs text-ink-500">
                          {m.manager_ecode}{m.department && ` · ${m.department}`}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.team_size}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{m.kpi_approved}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-700">{m.kpi_awaiting_approval}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-cyrixRed-700">{m.kpi_not_set_up}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.months_awaiting_score ?? 0}</td>
                      <td className="px-4 py-3 text-right"><ScorePill value={m.team_avg_score} size="sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'tat' && (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">Manager turnaround</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Days from a team member submitting to the manager scoring, and to finalising.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2.5 font-medium">Manager</th>
                  <th className="px-4 py-2.5 text-right font-medium">Months handled</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg days to score</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg days to finalise</th>
                  <th className="px-4 py-2.5 text-right font-medium">Still pending</th>
                  <th className="px-4 py-2.5 text-right font-medium">Oldest pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {(tat ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-400">
                      No months have been submitted yet.
                    </td>
                  </tr>
                ) : (
                  [...(tat ?? [])]
                    .sort((a, b) => (b.avg_days_to_score ?? 0) - (a.avg_days_to_score ?? 0))
                    .map(t => (
                      <tr key={t.manager_id ?? 'none'} className="hover:bg-ink-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-ink-900">{t.manager_name ?? '—'}</p>
                          <p className="text-xs text-ink-500">{t.manager_ecode}</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{t.months_handled}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {t.avg_days_to_score ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {t.avg_days_to_finalize ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {t.still_awaiting_score > 0
                            ? <span className="badge bg-amber-100 text-amber-800">{t.still_awaiting_score}</span>
                            : <span className="text-ink-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                          {t.oldest_pending_days ? `${t.oldest_pending_days} d` : '—'}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
