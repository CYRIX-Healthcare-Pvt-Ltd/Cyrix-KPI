import { useState, useMemo } from 'react'
import { Download, BarChart3 } from 'lucide-react'
import { useOrgKpiStatus, currentFy } from '@/lib/queries'
import { supabase, friendlyError } from '@/lib/supabase'
import { exportKpiScores } from '@/lib/export'
import { PageLoader, Alert, Spinner } from '@/components/ui'
import KpiReport from './KpiReport'
import type { Employee } from '@/types/db'

// Completion by month, completion by manager and turnaround were three
// tabs answering one question with the same population over the same
// period, differing only in how they grouped. They are now one report
// whose shape is chosen; see KpiReport. The score export stays separate
// because it is a different artefact — a per-employee workbook, not a
// summary.
type Tab = 'report' | 'scores'

export default function AdminReports() {
  const fy = currentFy()
  const [tab, setTab] = useState<Tab>('report')
  const { data: org, isLoading } = useOrgKpiStatus(true, fy)

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
          ['report', 'KPI report', BarChart3],
          ['scores', 'Score export', Download],
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

      {tab === 'report' && <KpiReport />}

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
    </div>
  )
}
