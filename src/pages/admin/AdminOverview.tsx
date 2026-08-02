import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis,
  CartesianGrid,
} from 'recharts'
import { Users, Clock, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'
import {
  useOrgKpiStatus, useManagerCompletion, useManagerTat, useRemovalRequests, currentFy,
} from '@/lib/queries'
import { PageLoader, StatTile, ScorePill, Alert } from '@/components/ui'
import { ScoreHeader } from '@/components/analysis'
import CompletionByDimension from '@/components/CompletionByDimension'
import { bandFor } from '@/lib/bands'

const STATUS_COLOURS: Record<string, string> = {
  active: '#059669',
  pending_approval: '#d97706',
  draft: '#64748b',
  rejected: '#d21f38',
  not_set_up: '#adb4c2',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Approved',
  pending_approval: 'Awaiting approval',
  draft: 'Draft',
  rejected: 'Sent back',
  not_set_up: 'Not set up',
}

export default function AdminOverview() {
  const fy = currentFy()
  const { data: org, isLoading } = useOrgKpiStatus(true, fy)
  const { data: managers } = useManagerCompletion(true)
  const { data: tat } = useManagerTat(true, fy)
  const { data: removals } = useRemovalRequests('pending')

  const stats = useMemo(() => {
    if (!org) return null
    const byStatus: Record<string, number> = {}
    let scored = 0
    let awaiting = 0
    const scores: number[] = []

    for (const e of org) {
      byStatus[e.kpi_status] = (byStatus[e.kpi_status] ?? 0) + 1
      scored += e.months_scored
      awaiting += e.months_awaiting_manager
      if (e.avg_score !== null) scores.push(e.avg_score)
    }

    return {
      total: org.length,
      byStatus,
      scored,
      awaiting,
      avgScore: scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null,
      withScores: scores.length,
    }
  }, [org])

  if (isLoading || !stats) return <PageLoader label="Loading organisation data…" />

  const pieData = Object.entries(stats.byStatus)
    .map(([k, v]) => ({ name: STATUS_LABELS[k] ?? k, value: v, key: k }))
    .sort((a, b) => b.value - a.value)

  const slowest = [...(tat ?? [])]
    .filter(t => t.avg_days_to_score !== null)
    .sort((a, b) => (b.avg_days_to_score ?? 0) - (a.avg_days_to_score ?? 0))
    .slice(0, 8)

  const behind = [...(managers ?? [])]
    .filter(m => m.kpi_not_set_up > 0 || (m.months_awaiting_score ?? 0) > 0)
    .sort((a, b) =>
      (b.kpi_not_set_up + (b.months_awaiting_score ?? 0)) -
      (a.kpi_not_set_up + (a.months_awaiting_score ?? 0)))
    .slice(0, 10)

  return (
    <div className="space-y-6">
      <ScoreHeader
        title="Organisation overview"
        subtitle={`FY ${fy} · ${stats.total} active employees`}
        score={stats.avgScore}
        scoreLabel="Company average"
      />

      {(removals?.length ?? 0) > 0 && (
        <Alert kind="warning" title={`${removals!.length} removal request(s) awaiting you`}>
          <Link to="/admin/requests" className="btn-primary mt-3">
            Review requests <ArrowRight className="h-4 w-4" />
          </Link>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="KPIs approved"
          value={stats.byStatus.active ?? 0}
          sub={`of ${stats.total} employees`}
        />
        <StatTile
          label="Not set up yet"
          value={stats.byStatus.not_set_up ?? 0}
          sub="no KPI for this year"
        />
        <StatTile
          label="Awaiting manager score"
          value={stats.awaiting}
          sub="submitted months"
        />
        <StatTile
          label="Months scored"
          value={stats.scored}
          sub={`${stats.withScores} people with a score`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-800">KPI setup status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {pieData.map(d => (
                    <Cell key={d.key} fill={STATUS_COLOURS[d.key] ?? '#adb4c2'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d4d8e0' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {pieData.map(d => (
              <li key={d.key} className="flex items-center gap-1.5 text-xs text-ink-600">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: STATUS_COLOURS[d.key] ?? '#adb4c2' }}
                />
                {d.name} · <span className="font-semibold tabular-nums">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <CompletionByDimension />

        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink-800">
            Manager turnaround
          </h3>
          <p className="mb-3 text-xs text-ink-500">
            Average days from a team member submitting to the manager scoring it.
          </p>
          <div className="h-64">
            {slowest.length === 0 ? (
              <p className="pt-16 text-center text-sm text-ink-400">
                No months have been scored yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={slowest} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#606b82' }} />
                  <YAxis
                    type="category"
                    dataKey="manager_ecode"
                    width={60}
                    tick={{ fontSize: 11, fill: '#606b82' }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d4d8e0' }}
                    formatter={(v: unknown) => (typeof v === 'number' ? `${v} days` : '—')}
                    labelFormatter={(l: unknown) =>
                      slowest.find(s => s.manager_ecode === l)?.manager_name ?? String(l)}
                  />
                  <Bar dataKey="avg_days_to_score" fill="#11141c" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Managers with outstanding work
          </h3>
          <Link to="/admin/reports" className="link-accent text-xs hover:underline">
            All reports
          </Link>
        </div>

        {behind.length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> Every manager is up to date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2.5 font-medium">Manager</th>
                  <th className="px-4 py-2.5 text-right font-medium">Team</th>
                  <th className="px-4 py-2.5 text-right font-medium">KPI not set up</th>
                  <th className="px-4 py-2.5 text-right font-medium">Awaiting approval</th>
                  <th className="px-4 py-2.5 text-right font-medium">To score</th>
                  <th className="px-4 py-2.5 text-right font-medium">Team avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {behind.map(m => (
                  <tr key={m.manager_id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{m.manager_name}</p>
                      <p className="text-xs text-ink-500">
                        {m.manager_ecode}{m.department && ` · ${m.department}`}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.team_size}</td>
                    <td className="px-4 py-3 text-right">
                      <Count n={m.kpi_not_set_up} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Count n={m.kpi_awaiting_approval} tone="amber" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Count n={m.months_awaiting_score ?? 0} tone="amber" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ScorePill value={m.team_avg_score} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={Users}
          label="Managers"
          value={managers?.length ?? 0}
          to="/admin/reports"
        />
        <SummaryCard
          icon={Clock}
          label="Slowest turnaround"
          value={
            slowest[0]?.avg_days_to_score !== undefined && slowest[0]
              ? `${slowest[0].avg_days_to_score} days`
              : '—'
          }
          sub={slowest[0]?.manager_name ?? undefined}
          to="/admin/reports"
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Company average"
          value={stats.avgScore === null ? '—' : stats.avgScore.toFixed(1)}
          sub={bandFor(stats.avgScore)?.label}
          to="/admin/reports"
        />
      </div>
    </div>
  )
}

function Count({ n, tone = 'red' }: { n: number; tone?: 'red' | 'amber' }) {
  if (n === 0) return <span className="text-ink-300">—</span>
  return (
    <span className={`badge ${
      tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-cyrixRed-100 text-cyrixRed-800'
    }`}>
      {n}
    </span>
  )
}

function SummaryCard({
  icon: Icon, label, value, sub, to,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub?: string
  to: string
}) {
  return (
    <Link to={to} className="card card-interactive p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-ink-100 p-2 text-ink-600">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{value}</p>
          {sub && <p className="truncate text-xs text-ink-500">{sub}</p>}
        </div>
      </div>
    </Link>
  )
}
