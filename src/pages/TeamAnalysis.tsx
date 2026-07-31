import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, TrendingDown, AlertTriangle, Users } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyTeam, useTeamSubmissions, useWeakAreas, useKraAttainment, currentFy,
} from '@/lib/queries'
import { fyMonths } from '@/lib/fy'
import { bandFor, isWeak, trendOf } from '@/lib/bands'
import { PageLoader, ScorePill, StatTile, EmptyState } from '@/components/ui'
import { ScoreHeader, TrendChip, BandChip, KraBars } from '@/components/analysis'

const SCORED = new Set(['scored', 'finalized'])

export default function TeamAnalysis() {
  const { employee } = useAuth()
  const fy = currentFy()

  const { data: team, isLoading } = useMyTeam(employee?.id)
  const ids = useMemo(() => (team ?? []).map(t => t.id), [team])
  const { data: subs } = useTeamSubmissions(ids.length ? ids : undefined, fy)
  const { data: weak } = useWeakAreas(ids.length ? ids : undefined, fy)
  const { data: attainment } = useKraAttainment(ids.length ? ids : undefined, fy)

  const analysis = useMemo(() => {
    if (!team || !subs) return null
    const months = fyMonths(fy)

    const people = team.map(member => {
      const mine = subs.filter(s => s.employee_id === member.id && SCORED.has(s.status))
      const byMonth = new Map(mine.map(s => [s.period_month, s]))
      const series = months.map(m => byMonth.get(m)?.final_total_score ?? null)
      const scored = series.filter((v): v is number => v !== null)
      const avg = scored.length
        ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
        : null

      return {
        member,
        avg,
        series,
        monthsScored: scored.length,
        trend: trendOf(series),
        weakAreas: (weak ?? []).filter(
          w => w.employee_id === member.id && isWeak(w.avg_attainment_pct),
        ),
      }
    })

    const rated = people.filter(p => p.avg !== null)
    const teamAvg = rated.length
      ? Math.round((rated.reduce((a, p) => a + (p.avg ?? 0), 0) / rated.length) * 10) / 10
      : null

    return {
      people,
      teamAvg,
      best: [...rated].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 5),
      struggling: [...rated]
        .filter(p => isWeak(p.avg))
        .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0)),
      declining: rated.filter(p => p.trend?.direction === 'down'),
      unscored: people.filter(p => p.avg === null).length,
    }
  }, [team, subs, weak, fy])

  if (isLoading) return <PageLoader />

  if (!team || team.length === 0) {
    return (
      <EmptyState icon={Users} title="No team members">
        Nobody currently reports to you.
      </EmptyState>
    )
  }
  if (!analysis) return <PageLoader />

  return (
    <div className="space-y-5">
      <ScoreHeader
        title="Team analysis"
        subtitle={`${team.length} team members · FY ${fy}`}
        score={analysis.teamAvg}
        scoreLabel="Team average"
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Performing well"
          value={analysis.people.filter(p => (p.avg ?? 0) >= 80).length}
          sub="Very Good or better"
        />
        <StatTile
          label="Need support"
          value={analysis.struggling.length}
          sub="below Good"
        />
        <StatTile
          label="Declining"
          value={analysis.declining.length}
          sub="trending down"
        />
        <StatTile
          label="No scores yet"
          value={analysis.unscored}
          sub={`of ${team.length}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <Trophy className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-ink-800">Doing best</h3>
          </div>
          {analysis.best.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">No scored months yet.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {analysis.best.map(p => (
                <PersonRow key={p.member.id} p={p} />
              ))}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-cyrixRed-600" />
            <h3 className="text-sm font-semibold text-ink-800">Needing support</h3>
          </div>
          {analysis.struggling.length === 0 ? (
            <p className="p-4 text-sm text-emerald-800">
              Nobody is averaging below Good.
            </p>
          ) : (
            <div className="divide-y divide-ink-100">
              {analysis.struggling.map(p => (
                <PersonRow key={p.member.id} p={p} showWeak />
              ))}
            </div>
          )}
        </div>
      </div>

      {analysis.declining.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <TrendingDown className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-ink-800">Trending downward</h3>
            <span className="ml-auto text-xs text-ink-400">
              last two months against the two before
            </span>
          </div>
          <div className="divide-y divide-ink-100">
            {analysis.declining.map(p => (
              <PersonRow key={p.member.id} p={p} />
            ))}
          </div>
        </div>
      )}

      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-ink-800">
          Where the team is weakest
        </h3>
        <p className="mb-4 text-xs text-ink-500">
          Average attainment against each KRA's own weightage, across everyone.
        </p>
        <KraBars rows={attainment ?? []} />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">Everyone</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">Team member</th>
                <th className="px-4 py-2.5 text-right font-medium">Average</th>
                <th className="px-4 py-2.5 font-medium">Band</th>
                <th className="px-4 py-2.5 font-medium">Trend</th>
                <th className="px-4 py-2.5 text-right font-medium">Months</th>
                <th className="px-4 py-2.5 font-medium">Weak areas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {analysis.people
                .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1))
                .map(p => (
                  <tr key={p.member.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/team/${p.member.id}`}
                        className="font-medium text-ink-900 hover:text-cyrixBlue-800 hover:underline"
                      >
                        {p.member.full_name}
                      </Link>
                      <p className="text-xs text-ink-500">{p.member.ecode}</p>
                    </td>
                    <td className="px-4 py-3 text-right"><ScorePill value={p.avg} size="sm" /></td>
                    <td className="px-4 py-3"><BandChip pct={p.avg} /></td>
                    <td className="px-4 py-3"><TrendChip scores={p.series} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                      {p.monthsScored}
                    </td>
                    <td className="px-4 py-3">
                      {p.weakAreas.length === 0 ? (
                        <span className="text-xs text-ink-400">none</span>
                      ) : (
                        <span className="text-xs text-cyrixRed-700">
                          {p.weakAreas.map(w => w.kra).slice(0, 2).join(', ')}
                          {p.weakAreas.length > 2 && ` +${p.weakAreas.length - 2}`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PersonRow({
  p, showWeak,
}: {
  p: {
    member: { id: string; ecode: string; full_name: string }
    avg: number | null
    series: Array<number | null>
    weakAreas: Array<{ kra: string; avg_attainment_pct: number | null }>
  }
  showWeak?: boolean
}) {
  const band = bandFor(p.avg)
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <Link
          to={`/team/${p.member.id}`}
          className="font-medium text-ink-900 hover:text-cyrixBlue-800 hover:underline"
        >
          {p.member.full_name}
        </Link>
        <p className="text-xs text-ink-500">{p.member.ecode}</p>
        {showWeak && p.weakAreas.length > 0 && (
          <p className="mt-1 text-xs text-cyrixRed-700">
            Weak in: {p.weakAreas.map(w =>
              `${w.kra} (${w.avg_attainment_pct?.toFixed(0)}%)`).join(', ')}
          </p>
        )}
        <div className="mt-1"><TrendChip scores={p.series} /></div>
      </div>
      <div className="text-right">
        <ScorePill value={p.avg} />
        {band && <p className={`mt-1 text-[11px] ${band.accent}`}>{band.label}</p>}
      </div>
    </div>
  )
}
