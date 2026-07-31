import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamMonth, currentFy } from '@/lib/queries'
import { fyMonths, monthLabel, currentReportingMonth } from '@/lib/fy'
import {
  PageLoader, ScorePill, StatusBadge, StatTile, EmptyState,
} from '@/components/ui'

export default function Team() {
  const { employee } = useAuth()
  const fy = currentFy()
  const [month, setMonth] = useState(currentReportingMonth())
  const { data, isLoading } = useTeamMonth(employee?.id, month, fy)

  if (isLoading) return <PageLoader />

  const team = data?.team ?? []
  const subsById = new Map((data?.submissions ?? []).map(s => [s.employee_id, s]))
  const assignById = new Map((data?.assignments ?? []).map(a => [a.employee_id, a]))

  if (team.length === 0) {
    return (
      <EmptyState icon={Users} title="No team members">
        Nobody currently reports to you.
      </EmptyState>
    )
  }

  const awaiting = team.filter(t => subsById.get(t.id)?.status === 'submitted').length
  const notStarted = team.filter(t => {
    const s = subsById.get(t.id)
    return !s || s.status === 'draft'
  }).length
  const done = team.filter(t => {
    const s = subsById.get(t.id)?.status
    return s === 'scored' || s === 'finalized'
  }).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">My team</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {team.length} member{team.length === 1 ? '' : 's'} · FY {fy}
          </p>
        </div>
        <select
          className="input w-auto"
          value={month}
          onChange={e => setMonth(e.target.value)}
        >
          {fyMonths(fy).map(m => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Waiting for my score" value={awaiting} tone={awaiting > 0 ? 'brand' : 'default'} />
        <StatTile label="Not submitted yet" value={notStarted} />
        <StatTile label="Scored" value={done} sub={`of ${team.length}`} />
      </div>

      <div className="card divide-y divide-slate-100 overflow-hidden">
        {team.map(member => {
          const sub = subsById.get(member.id)
          const assign = assignById.get(member.id)
          const needsScoring = sub?.status === 'submitted'

          return (
            <div key={member.id} className="flex items-center gap-3 p-4 hover:bg-slate-50">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {member.full_name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{member.full_name}</p>
                <p className="truncate text-xs text-slate-500">
                  {member.ecode}
                  {member.designation && ` · ${member.designation}`}
                </p>
                {assign?.status !== 'active' && (
                  <p className="mt-1 text-xs text-amber-700">
                    KPI {assign ? assign.status.replace('_', ' ') : 'not set up'}
                  </p>
                )}
              </div>

              <div className="hidden text-right sm:block">
                <StatusBadge status={sub?.status ?? null} />
              </div>

              <div className="w-16 text-right">
                <ScorePill value={sub?.final_total_score ?? sub?.self_total_score} size="sm" />
              </div>

              {needsScoring && sub ? (
                <Link to={`/score/${sub.id}`} className="btn-primary shrink-0 !px-3 !py-1.5 text-xs">
                  Score
                </Link>
              ) : (
                <Link
                  to={`/team/${member.id}`}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`View ${member.full_name}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
