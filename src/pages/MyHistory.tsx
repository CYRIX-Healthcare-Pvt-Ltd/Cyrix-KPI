import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useAuth } from '@/contexts/AuthContext'
import { useSubmissionHistory, useAnnualSummary, currentFy } from '@/lib/queries'
import { fyMonths, monthLabel } from '@/lib/fy'
import { PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'

export default function MyHistory() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { data: history, isLoading } = useSubmissionHistory(employee?.id, fy)
  const { data: annual } = useAnnualSummary(employee?.id, fy)

  if (isLoading) return <PageLoader />

  const byMonth = new Map((history ?? []).map(s => [s.period_month, s]))

  const chartData = fyMonths(fy).map(m => {
    const s = byMonth.get(m)
    const scored = s && (s.status === 'scored' || s.status === 'finalized')
    return {
      month: monthLabel(m).split('-')[0],
      'Job role': scored ? s.final_job_role_score : null,
      'Core values': scored ? s.final_core_score : null,
      Total: scored ? s.final_total_score : null,
    }
  })

  const hasAnyScore = chartData.some(d => d.Total !== null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My history</h1>
        <p className="mt-0.5 text-sm text-slate-500">FY {fy} · April to March</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Year average"
          value={<ScorePill value={annual?.avg_total_score} size="lg" />}
          sub="out of 100"
          tone="brand"
        />
        <StatTile label="Months scored" value={annual?.months_scored ?? 0} sub="of 12" />
        <StatTile label="Best month" value={annual?.highest_month?.toFixed(1) ?? '—'} />
        <StatTile label="Lowest month" value={annual?.lowest_month?.toFixed(1) ?? '—'} />
      </div>

      {hasAnyScore && (
        <div className="card p-4">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">Score trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—')}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Total" stroke="#0f766e" strokeWidth={2}
                      dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="Job role" stroke="#0ea5e9" strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="Core values" stroke="#f59e0b" strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-800">Month by month</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Self</th>
                <th className="px-4 py-2.5 text-right font-medium">Manager</th>
                <th className="px-4 py-2.5 text-right font-medium">Final</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fyMonths(fy).map(m => {
                const s = byMonth.get(m)
                return (
                  <tr key={m} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                      {monthLabel(m)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s?.status ?? null} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {s?.self_total_score?.toFixed(2) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {s?.mgr_total_score?.toFixed(2) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ScorePill value={s?.final_total_score} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/submission/${m}`}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        {s ? 'View' : 'Start'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
