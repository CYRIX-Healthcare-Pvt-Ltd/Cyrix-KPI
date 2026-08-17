import { Fragment, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import {
  useSubmissionHistory, useAnnualSummary, useMyAssignment, useSetKpiStart, currentFy,
} from '@/lib/queries'
import { StartMonthBanner } from '@/components/StartMonth'
import { fyMonthsFrom, openFyMonthsFrom, monthLabel } from '@/lib/fy'
import {
  PageLoader, ScorePill, StatTile, StatusBadge, Alert, BandCell,
} from '@/components/ui'
import BandTrend from '@/components/BandTrend'
import { sectionsOf, JOB_ROLE_TOTAL } from '@/lib/sections'
import type { Employee } from '@/types/db'

export default function TeamMember() {
  const { employeeId = '' } = useParams()
  const fy = currentFy()
  const setStart = useSetKpiStart()
  const [startError, setStartError] = useState<string | null>(null)

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
  // Months this person's KPI covers. Before this, a manager looking at a
  // June joiner saw April and May sitting empty on their record.
  const startsFrom = assignment?.assignment?.starts_from ?? null
  const months = fyMonthsFrom(fy, startsFrom)

  // Only months that have finished. The table below lists the whole year
  // on purpose — it is the record, and a month still to come is a row
  // waiting to be filled — but a chart cannot draw a month that has not
  // happened, so plotting all twelve left the line stopping a third of
  // the way across an axis that ran to March.
  const chartData = openFyMonthsFrom(fy, startsFrom).map(m => {
    const s = byMonth.get(m)
    const scored = s && (s.status === 'scored' || s.status === 'finalized')
    return {
      month: m,
      total: scored ? s.final_total_score : null,
      job: scored ? s.final_job_role_score : null,
      esms: scored ? s.final_esms_score : null,
      core: scored ? s.final_core_score : null,
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

      <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-4">
        <StatTile
          label={`FY ${fy} average`}
          value={<ScorePill value={annual?.avg_total_score} size="lg" />}
          tone="brand"
        />
        <StatTile label="Months scored" value={annual?.months_scored ?? 0} sub="of 12" />
        <StatTile label="Best" value={annual?.highest_month?.toFixed(1) ?? '—'} />
        <StatTile label="Lowest" value={annual?.lowest_month?.toFixed(1) ?? '—'} />
      </div>

      {chartData.some(d => d.total !== null) && (
        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink-800">Score trend</h3>
          <p className="mb-3 text-xs text-ink-500">
            The total, and what it is made of. Job role is out of{' '}
            {JOB_ROLE_TOTAL} and core values out of{' '}
            {100 - JOB_ROLE_TOTAL - esmsWeight}
            {hasEsms && `, with ESMS out of ${esmsWeight}`}.
          </p>
          <BandTrend points={chartData} hasEsms={hasEsms} />
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
              {months.map(m => {
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
      {assignment?.assignment && (
        <>
          {/* The manager's place to fix this. It is the only screen that
              shows one person's whole year, which is where somebody
              notices the start month is wrong — and the approval screen
              is gone by then, because the KPI is already approved. */}
          <StartMonthBanner
            fy={fy}
            startsFrom={startsFrom}
            who={member.full_name.split(' ')[0]}
            editable
            busy={setStart.isPending}
            onChange={month => {
              setStartError(null)
              setStart.mutate(
                { assignmentId: assignment.assignment!.id, month },
                { onError: e => setStartError(e.message) },
              )
            }}
          />
          {startError && <Alert kind="error">{startError}</Alert>}
        </>
      )}

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
