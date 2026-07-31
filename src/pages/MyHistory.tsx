import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSubmissionHistory, useAnnualSummary, currentFy } from '@/lib/queries'
import { fyMonths, monthLabel, isMonthOpen } from '@/lib/fy'
import { PageLoader, ScorePill, StatTile, StatusBadge } from '@/components/ui'
import { ScoreHeader } from '@/components/analysis'

export default function MyHistory() {
  const { employee } = useAuth()
  const fy = currentFy()
  const { data: history, isLoading } = useSubmissionHistory(employee?.id, fy)
  const { data: annual } = useAnnualSummary(employee?.id, fy)

  if (isLoading) return <PageLoader />

  const byMonth = new Map((history ?? []).map(s => [s.period_month, s]))

  const chartData = fyMonths(fy)
    .filter(m => isMonthOpen(m))
    .map(m => {
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
      <ScoreHeader
        title="My history"
        subtitle={`FY ${fy} · April to March`}
        score={annual?.avg_total_score}
        scoreLabel="Year average"
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Months scored" value={annual?.months_scored ?? 0} sub="of 12" />
        <StatTile label="Best month" value={annual?.highest_month?.toFixed(1) ?? '—'} />
        <StatTile label="Lowest month" value={annual?.lowest_month?.toFixed(1) ?? '—'} />
        <StatTile
          label="Job role / core values"
          value={
            <span className="text-base">
              {annual?.avg_job_role_score?.toFixed(1) ?? '—'}
              <span className="text-ink-400"> / </span>
              {annual?.avg_core_values_score?.toFixed(1) ?? '—'}
            </span>
          }
          sub="out of 80 and 20"
        />
      </div>

      {hasAnyScore && (
        <div className="card p-4">
          <h3 className="mb-4 text-sm font-semibold text-ink-800">Score trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeef0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b6e79' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#6b6e79' }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd' }}
                  formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—')}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Total" stroke="#141519" strokeWidth={2.5}
                      dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="Job role" stroke="#e30613" strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="Core values" stroke="#8a8d97" strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">Month by month</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5">Month</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Self</th>
                <th className="px-4 py-2.5 text-right">Manager</th>
                <th className="px-4 py-2.5 text-right">Final</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {fyMonths(fy).map(m => {
                const s = byMonth.get(m)
                // A month that has not finished cannot be assessed yet.
                const open = isMonthOpen(m)

                return (
                  <tr
                    key={m}
                    className={open ? 'hover:bg-ink-50' : 'bg-ink-50/40 text-ink-300'}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <span className={open ? 'text-ink-900' : 'text-ink-400'}>
                        {monthLabel(m)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {open ? (
                        <StatusBadge status={s?.status ?? null} />
                      ) : (
                        <span className="badge inline-flex items-center gap-1 bg-ink-100 text-ink-400">
                          <Lock className="h-3 w-3" /> Not yet open
                        </span>
                      )}
                    </td>
                    {/* A month that is not open cannot legitimately hold a
                        score, so nothing is shown even if stale draft rows
                        exist from before the gate was added. */}
                    <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                      {open ? s?.self_total_score?.toFixed(2) ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                      {open ? s?.mgr_total_score?.toFixed(2) ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {open
                        ? <ScorePill value={s?.final_total_score} size="sm" />
                        : <span className="text-ink-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {open ? (
                        <Link
                          to={`/submission/${m}`}
                          className="text-xs font-semibold text-ink-900 hover:text-cyrixRed-600 hover:underline"
                        >
                          {s ? 'View' : 'Start'}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-300">—</span>
                      )}
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
