import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, ChevronRight, Download, BarChart3, UserMinus, Spline,
  LineChart as LineChartIcon,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useTeamMonth, useTeamSubmissions, useRemovalAction, currentFy,
} from '@/lib/queries'
import { openFyMonths, monthLabel, currentReportingMonth } from '@/lib/fy'
import { exportKpiScores } from '@/lib/export'
import {
  PageLoader, ScorePill, StatusBadge, StatTile, EmptyState, Alert, Spinner,
} from '@/components/ui'
import { ScoreHeader, ActionRequired } from '@/components/analysis'
import ScoreTrend from '@/components/ScoreTrend'
import { useAmbientScore } from '@/contexts/ScoreThemeContext'
import type { KpiSubmission } from '@/types/db'

const SCORED = new Set(['scored', 'finalized'])

export default function Team() {
  const { employee } = useAuth()
  const fy = currentFy()
  const [month, setMonth] = useState(currentReportingMonth())
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, isLoading } = useTeamMonth(employee?.id, month, fy)
  const ids = useMemo(() => (data?.team ?? []).map(t => t.id), [data])
  const { data: allSubs } = useTeamSubmissions(ids.length ? ids : undefined, fy)

  const team = data?.team ?? []
  const subsById = new Map((data?.submissions ?? []).map(s => [s.employee_id, s]))
  const assignById = new Map((data?.assignments ?? []).map(a => [a.employee_id, a]))

  /** Team average across the year — drives the page's colour. */
  const teamAvg = useMemo(() => {
    const scored = (allSubs ?? []).filter(s => SCORED.has(s.status) && s.final_total_score !== null)
    if (scored.length === 0) return null
    const byPerson = new Map<string, number[]>()
    for (const s of scored) {
      const list = byPerson.get(s.employee_id) ?? []
      list.push(s.final_total_score!)
      byPerson.set(s.employee_id, list)
    }
    const perPerson = [...byPerson.values()].map(v => v.reduce((a, b) => a + b, 0) / v.length)
    return Math.round((perPerson.reduce((a, b) => a + b, 0) / perPerson.length) * 10) / 10
  }, [allSubs])

  /**
   * The team average for each finished month.
   *
   * Everyone who was scored that month, averaged — so a month where only
   * two people were scored is two people's average and says so in the
   * tooltip's month label rather than pretending to be the whole team.
   */
  const trend = useMemo(() => {
    const byMonth = new Map<string, number[]>()
    for (const s of allSubs ?? []) {
      if (!SCORED.has(s.status) || s.final_total_score === null) continue
      const list = byMonth.get(s.period_month) ?? []
      list.push(s.final_total_score)
      byMonth.set(s.period_month, list)
    }
    return openFyMonths(fy).map(m => {
      const v = byMonth.get(m)
      return {
        month: m,
        score: v?.length
          ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10
          : null,
      }
    })
  }, [allSubs, fy])

  const download = async () => {
    setBusy(true); setError(null)
    try {
      const byEmp = new Map<string, typeof allSubs>()
      for (const s of allSubs ?? []) {
        const list = byEmp.get(s.employee_id) ?? []
        list!.push(s)
        byEmp.set(s.employee_id, list)
      }
      await exportKpiScores(
        team.map(employee => ({ employee, submissions: byEmp.get(employee.id) ?? [] })),
        fy,
        `Cyrix-KPI-my-team-${fy}.xlsx`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the export.')
    } finally {
      setBusy(false)
    }
  }

  // On the team screens the chrome follows the team's average, not the
  // manager's own score.
  useAmbientScore(teamAvg)

  if (isLoading) return <PageLoader />

  if (team.length === 0) {
    return (
      <EmptyState icon={Users} title="No team members">
        Nobody currently reports to you.
      </EmptyState>
    )
  }

  const waiting = team.filter(t => subsById.get(t.id)?.status === 'submitted')
  const awaiting = waiting.length
  const notStarted = team.filter(t => {
    const s = subsById.get(t.id)
    return !s || s.status === 'draft'
  }).length
  const done = team.filter(t => SCORED.has(subsById.get(t.id)?.status ?? '')).length

  // The call to action has to land on something to score. It pointed at
  // /team — the page it is already on — so the button did nothing.
  const firstToScore = waiting.length ? subsById.get(waiting[0].id) : undefined

  return (
    <div className="space-y-5">
      <ScoreHeader
        title="My team"
        subtitle={`${team.length} member${team.length === 1 ? '' : 's'} · FY ${fy}`}
        score={teamAvg}
        scoreLabel="Team average"
      >
        {/* Two columns on a phone: the month picker spans both, then the
            two actions sit side by side at equal width. A plain flex-wrap
            row left them ragged, breaking after one button on one width
            and after two on the next. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            className="select-on-dark col-span-2 sm:w-auto"
            value={month}
            onChange={e => setMonth(e.target.value)}
            aria-label="Month"
          >
            {/* Completed months only — a month in progress cannot be assessed. */}
            {openFyMonths(fy).reverse().map(m => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
          <Link to="/team/analysis" className="btn-on-dark">
            <BarChart3 className="h-4 w-4" /> Team analysis
          </Link>
          <button onClick={download} className="btn-excel" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            Export to Excel
          </button>
        </div>
      </ScoreHeader>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {awaiting > 0 && firstToScore && (
        <ActionRequired
          eyebrow="Scoring Due"
          title={`${awaiting} assessment${awaiting === 1 ? '' : 's'} waiting for you`}
          body={
            awaiting === 1
              ? `${waiting[0].full_name} has submitted ${monthLabel(month)} and it cannot be finalised until you score it.`
              : `Your team has submitted ${monthLabel(month)} and those months cannot be finalised until you score them. Starting with ${waiting[0].full_name}.`
          }
          to={`/score/${firstToScore.id}`}
          cta="Start Scoring"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Waiting for my score"
          value={awaiting}
          tone={awaiting > 0 ? 'brand' : 'default'}
        />
        <StatTile label="Not submitted yet" value={notStarted} />
        <StatTile label="Scored" value={done} sub={`of ${team.length}`} />
      </div>

      <div className="card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-800">
          <LineChartIcon className="h-4 w-4 text-ink-400" /> Team average, month by month
        </h3>
        <p className="mb-3 text-xs text-ink-500">
          Everyone who was scored that month, averaged, on the band scale.
        </p>
        <ScoreTrend
          points={trend}
          emptyMessage="No months scored yet — the line starts with your first one."
        />
      </div>

      {removing && (
        <RemovalForm
          employeeId={removing.id}
          name={removing.name}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null)
            setNotice(`Removal request for ${removing.name} sent to HR.`)
          }}
        />
      )}

      <div className="card divide-y divide-ink-100 overflow-hidden">
        {team.map(member => {
          const sub = subsById.get(member.id)
          const assign = assignById.get(member.id)
          const needsScoring = sub?.status === 'submitted'

          return (
            <div key={member.id} className="flex items-center gap-3 p-4 hover:bg-ink-50">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                {member.full_name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-900">{member.full_name}</p>
                <p className="truncate text-xs text-ink-500">
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

              <div className="w-24 shrink-0 text-right sm:w-32">
                <ScorePill value={sub?.final_total_score ?? sub?.self_total_score} size="sm" />
                <SectionSplit
                  sub={sub}
                  hasEsms={Number(assign?.esms_weight ?? 0) > 0}
                />
              </div>

              {needsScoring && sub ? (
                <Link to={`/score/${sub.id}`} className="btn-primary shrink-0 !px-3 !py-1.5 text-xs">
                  Score
                </Link>
              ) : (
                <Link
                  to={`/team/${member.id}`}
                  className="shrink-0 btn-icon"
                  aria-label={`View ${member.full_name}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              )}

              <button
                onClick={() => setRemoving({ id: member.id, name: member.full_name })}
                className="shrink-0 rounded-lg p-2 text-ink-300 hover:bg-cyrixRed-50 hover:text-cyrixRed-700"
                aria-label={`Request removal of ${member.full_name}`}
                title="Request removal (resigned)"
              >
                <UserMinus className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-400">
        <Spline className="h-3.5 w-3.5" />
        The page tint reflects your team's average score.
      </p>
    </div>
  )
}

/**
 * The bands behind a total.
 *
 * Job role is 80 of the 100 and core values are the rest — the same
 * fifteen or twenty points that most people earn most months. So a total
 * of 85 can be a strong job role, or it can be a weak one carried by the
 * part that barely moves, and the total on its own cannot tell the two
 * apart. This is the number a manager actually needs before a review
 * conversation, so it travels with the total rather than being a click
 * away.
 *
 * Whether ESMS is shown comes from the KPI, not from the score: somebody
 * who carries ESMS and has not been scored on it yet gets a dash, rather
 * than the row silently changing shape the month their first one lands.
 */
function SectionSplit({
  sub, hasEsms,
}: {
  sub: KpiSubmission | undefined
  hasEsms: boolean
}) {
  if (!sub) return null

  const final = SCORED.has(sub.status)
  const parts: Array<[string, number | null]> = [
    ['Job', final ? sub.final_job_role_score : sub.self_job_role_score],
    ...(hasEsms
      ? [['ESMS', final ? sub.final_esms_score : sub.self_esms_score] as [string, number | null]]
      : []),
    ['Core', final ? sub.final_core_score : sub.self_core_score],
  ]
  if (parts.every(([, v]) => v === null)) return null

  return (
    <p
      className="mt-1 flex flex-wrap justify-end gap-x-2 gap-y-0.5 text-[10px] leading-tight"
      title={final ? 'Final scores by band' : 'Self assessment by band'}
    >
      {parts.map(([label, v]) => (
        <span key={label} className="whitespace-nowrap">
          <span className="text-ink-400">{label}</span>{' '}
          <span className="font-semibold tabular-nums text-ink-600">
            {v === null ? '—' : v.toFixed(1)}
          </span>
        </span>
      ))}
    </p>
  )
}

/**
 * Managers flag a leaver; HR decides. Deliberately a request rather than
 * a direct action — deactivating someone removes their access and their
 * manager's ability to see the history.
 */
function RemovalForm({
  employeeId, name, onClose, onDone,
}: {
  employeeId: string
  name: string
  onClose: () => void
  onDone: () => void
}) {
  const action = useRemovalAction()
  const [reason, setReason] = useState('')
  const [lastDay, setLastDay] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    try {
      await action.mutateAsync({
        action: 'request',
        employeeId,
        reason,
        lastWorkingDay: lastDay || null,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request.')
    }
  }

  return (
    <div className="card space-y-3 border-cyrixRed-200 p-4">
      <div>
        <h3 className="font-medium text-ink-900">Request removal of {name}</h3>
        <p className="mt-0.5 text-sm text-ink-500">
          This goes to HR for approval — it does not remove them immediately.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label text-xs">Reason</label>
          <input
            className="input"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Resigned, last working day 15 Aug"
            autoFocus
          />
        </div>
        <div>
          <label className="label text-xs">Last working day (optional)</label>
          <input
            type="date"
            className="input"
            value={lastDay}
            onChange={e => setLastDay(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!reason.trim() || action.isPending}
          className="btn-danger"
        >
          {action.isPending && <Spinner className="h-4 w-4" />}
          Send request to HR
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}
