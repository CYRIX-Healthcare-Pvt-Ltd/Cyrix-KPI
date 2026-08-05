import { Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { ArrowLeft } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { useSubmissionHistory, useAnnualSummary, useMyAssignment, currentFy } from '@/lib/queries'
import { fyMonths, monthLabel } from '@/lib/fy'
import {
  PageLoader, ScorePill, StatTile, StatusBadge, Alert, BandCell,
} from '@/components/ui'
import { ScoreLabel, TREND_MARGIN } from '@/components/ScoreTrend'
import { sectionsOf } from '@/lib/sections'
import type { Employee } from '@/types/db'

export default function TeamMember() {
  const { employeeId = '' } = useParams()
  const fy = currentFy()

  const { data: member, isLoading } = useQuery({
    enabled: !!employeeId,
    queryKey: ['employee', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees').select('*').eq('id', employeeId).single()
      if (error) throw new Error(friendlyError(error))
      return data as Employee
    },
  })

  const { data: history } = useSubmissionHistory(employeeId, fy)
  const { data: annual } = useAnnualSummary(employeeId, fy)
  const { data: assignment } = useMyAssignment(employeeId, fy)

  if (isLoading) return <PageLoader />
  if (!member) return <Alert kind="error">Team member not found.</Alert>

  const byMonth = new Map((history ?? []).map(s => [s.period_month, s]))
  // Which bands this person carries, read off the KPI rather than the
  // scores — so somebody with ESMS who has not been scored on it yet
  // still gets the line, rather than the chart changing shape later.
  const esmsWeight = Number(assignment?.assignment?.esms_weight ?? 0)
  const hasEsms = esmsWeight > 0

  const chartData = fyMonths(fy).map(m => {
    const s = byMonth.get(m)
    const scored = s && (s.status === 'scored' || s.status === 'finalized')
    return {
      month: monthLabel(m).split('-')[0],
      Total: scored ? s.final_total_score : null,
      'Job role': scored ? s.final_job_role_score : null,
      ESMS: scored ? s.final_esms_score : null,
      'Core values': scored ? s.final_core_score : null,
    }
  })

  return (
    <div className="space-y-5">
      <div>
        <Link to="/team" className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Back to my team
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">{member.full_name}</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {member.ecode}
          {member.designation && ` · ${member.designation}`}
          {member.department && ` · ${member.department}`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label={`FY ${fy} average`}
          value={<ScorePill value={annual?.avg_total_score} size="lg" />}
          tone="brand"
        />
        <StatTile label="Months scored" value={annual?.months_scored ?? 0} sub="of 12" />
        <StatTile label="Best" value={annual?.highest_month?.toFixed(1) ?? '—'} />
        <StatTile label="Lowest" value={annual?.lowest_month?.toFixed(1) ?? '—'} />
      </div>

      {chartData.some(d => d.Total !== null) && (
        <div className="card p-4">
          <h3 className="mb-4 text-sm font-semibold text-ink-800">Score trend</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={TREND_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—')}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {/* The total, and then what it is made of. A total alone
                    cannot show a strong job role being carried by core
                    values, or the reverse — which is the thing a manager
                    is looking at this chart to find out.

                    Only the total is labelled. Four sets of numbers on
                    one plot collide with each other at every crossing,
                    and the legend plus the tooltip cover the rest. */}
                <Line
                  type="monotone" dataKey="Total" stroke="#141519" strokeWidth={2.5}
                  dot={{ r: 3 }} connectNulls
                  label={<ScoreLabel count={chartData.length} />}
                />
                <Line
                  type="monotone" dataKey="Job role" stroke="#e30613" strokeWidth={1.5}
                  dot={{ r: 2 }} connectNulls
                />
                {hasEsms && (
                  <Line
                    type="monotone" dataKey="ESMS" stroke="#7c3aed" strokeWidth={1.5}
                    dot={{ r: 2 }} connectNulls
                  />
                )}
                <Line
                  type="monotone" dataKey="Core values" stroke="#8a8d97" strokeWidth={1.5}
                  dot={{ r: 2 }} connectNulls
                />
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
              <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {/* "Mine" read as the manager's own row on their own
                    screen. It is their assessment of somebody else, and
                    the word for that is Manager. */}
                <th className="px-4 py-2.5 text-right font-medium">Self</th>
                <th className="px-4 py-2.5 text-right font-medium">Manager</th>
                <th className="px-4 py-2.5 text-right font-medium">Final</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {fyMonths(fy).map(m => {
                const s = byMonth.get(m)
                return (
                  <tr key={m} className="hover:bg-ink-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">
                      {monthLabel(m)}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s?.status ?? null} /></td>
                    {/* The total, and underneath it what it is made of.
                        A month at 88 built on a weak job role and a full
                        core-values score is a different conversation
                        from one built the other way round, and the total
                        alone cannot tell them apart. */}
                    <BandCell
                      total={s?.self_total_score}
                      job={s?.self_job_role_score}
                      esms={s?.self_esms_score}
                      core={s?.self_core_score}
                      hasEsms={hasEsms}
                    />
                    <BandCell
                      total={s?.mgr_total_score}
                      job={s?.mgr_job_role_score}
                      esms={s?.mgr_esms_score}
                      core={s?.mgr_core_score}
                      hasEsms={hasEsms}
                    />
                    <BandCell
                      total={s?.final_total_score}
                      job={s?.final_job_role_score}
                      esms={s?.final_esms_score}
                      core={s?.final_core_score}
                      hasEsms={hasEsms}
                      pill
                    />
                    <td className="px-4 py-3 text-right">
                      {s && (
                        <Link to={`/score/${s.id}`}
                              className="link-accent text-xs hover:underline">
                          {s.status === 'submitted' ? 'Score' : 'View'}
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* their KPI structure, for context while scoring */}
      {assignment?.items.length ? (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink-800">Their KPI for FY {fy}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-ink-100">
                {sectionsOf(assignment.assignment).map(({ key: section, label, weight }) => (
                  <Fragment key={section}>
                    <tr className="bg-ink-50/60">
                      <td colSpan={3} className="px-4 py-1.5 text-xs font-semibold text-ink-600">
                        {label} — {weight}%
                      </td>
                    </tr>
                    {assignment.items.filter(i => i.section === section).map(i => (
                      <tr key={i.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink-900">{i.kra}</p>
                          <p className="text-xs text-ink-500">{i.kpi_description}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                          {i.weightage}%
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink-500">
                          target {i.target_value ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
