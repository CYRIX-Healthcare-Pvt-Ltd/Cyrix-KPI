import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Users, ChevronRight, Download, BarChart3, UserMinus, Spline, X, ImageOff,
  Sigma, LineChart as LineChartIcon,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useTeamMonth, useTeamSubmissions, useRemovalAction, useRemoveAvatar,
  useSettleDueMonths, useOpenQueryMonths, currentFy,
} from '@/lib/queries'
import { openFyMonths, monthLabel, currentReportingMonth } from '@/lib/fy'
import { exportKpiScores } from '@/lib/export'
import {
  PageLoader, ScorePill, StatusBadge, StatTile, EmptyState, Alert, Spinner,
} from '@/components/ui'
import { ScoreHeader, ActionRequired, TeamBands } from '@/components/analysis'
import BellCurve from '@/components/BellCurve'
import { teamBandShare, attainmentPct } from '@/lib/bands'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import BandTrend from '@/components/BandTrend'
import Avatar from '@/components/Avatar'
import { useAmbientScore } from '@/contexts/ScoreThemeContext'
import type { KpiSubmission, KpiAssignment, Employee } from '@/types/db'

const SCORED = new Set(['scored', 'finalized'])

/** Which band the bell curve is plotting. */
type BellMetric = 'total' | 'job' | 'esms' | 'core'

const METRIC_LABEL: Record<BellMetric, string> = {
  total: 'Total',
  job: 'Job role',
  esms: 'ESMS',
  core: 'Core values',
}

export default function Team() {
  const { employee } = useAuth()
  const fy = currentFy()
  const [month, setMonth] = useState(currentReportingMonth())
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [peek, setPeek] = useState<string | null>(null)
  const [photoFor, setPhotoFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [chartTab, setChartTab] = useState<'trend' | 'bell'>('trend')
  const [bellMonth, setBellMonth] = useState('')
  const [bellMetric, setBellMetric] = useState<BellMetric>('total')

  const { data, isLoading } = useTeamMonth(employee?.id, month, fy)
  // Months close on the company closing date rather than by somebody
  // pressing a button, and nothing schedules that — so reading this
  // screen is what settles anything now due.
  useSettleDueMonths(true)
  // Which of these months have a question hanging over them.
  const { data: queried } = useOpenQueryMonths(true)
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
   * The same year the hero reports on, split into the bands it is made
   * of. Weights come from each person's own assignment, because core
   * values is 20% for most people and 15% for anyone carrying ESMS.
   */
  const bandShare = useMemo(() => {
    const byEmp = new Map<string, KpiSubmission[]>()
    for (const s of allSubs ?? []) {
      if (!SCORED.has(s.status)) continue
      const list = byEmp.get(s.employee_id) ?? []
      list.push(s)
      byEmp.set(s.employee_id, list)
    }
    return teamBandShare((data?.team ?? []).map(m => {
      const a = (data?.assignments ?? []).find(x => x.employee_id === m.id)
      return {
        weights: {
          job: Number(a?.job_role_weight ?? JOB_ROLE_TOTAL),
          esms: Number(a?.esms_weight ?? 0),
          core: Number(a?.core_values_weight ?? REMAINDER_TOTAL),
        },
        months: (byEmp.get(m.id) ?? []).map(s => ({
          job: s.final_job_role_score,
          esms: s.final_esms_score,
          core: s.final_core_score,
          total: s.final_total_score,
        })),
      }
    }))
  }, [allSubs, data])

  /**
   * One figure per person for the bell curve.
   *
   * Always a percentage of the band being plotted, never raw points —
   * core values is 20 for most people and 15 for anyone carrying ESMS,
   * so a distribution of raw core scores would put two different scales
   * on one axis and draw a second hump that is an artefact of the
   * weighting rather than of anybody's performance.
   */
  const bellValues = useMemo(() => {
    const weightsOf = (id: string) => {
      const a = (data?.assignments ?? []).find(x => x.employee_id === id)
      return {
        total: 100,
        job: Number(a?.job_role_weight ?? JOB_ROLE_TOTAL),
        esms: Number(a?.esms_weight ?? 0),
        core: Number(a?.core_values_weight ?? REMAINDER_TOTAL),
      }
    }
    const pick = (s: KpiSubmission) => ({
      total: s.final_total_score,
      job: s.final_job_role_score,
      esms: s.final_esms_score,
      core: s.final_core_score,
    }[bellMetric])

    const out: number[] = []
    for (const member of data?.team ?? []) {
      const rows = (allSubs ?? []).filter(s =>
        s.employee_id === member.id
        && SCORED.has(s.status)
        && (!bellMonth || s.period_month === bellMonth))
      const w = weightsOf(member.id)[bellMetric]
      const pcts = rows
        .map(s => attainmentPct(pick(s), w))
        .filter((v): v is number => v !== null)
      // Their own average first, so somebody scored on six months is one
      // person on this chart rather than six.
      if (pcts.length) out.push(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    }
    return out
  }, [allSubs, data, bellMonth, bellMetric])

  /**
   * The team average for each finished month.
   *
   * Everyone who was scored that month, averaged — so a month where only
   * two people were scored is two people's average and says so in the
   * tooltip's month label rather than pretending to be the whole team.
   */
  const trend = useMemo(() => {
    const byMonth = new Map<string, KpiSubmission[]>()
    for (const s of allSubs ?? []) {
      if (!SCORED.has(s.status) || s.final_total_score === null) continue
      const list = byMonth.get(s.period_month) ?? []
      list.push(s)
      byMonth.set(s.period_month, list)
    }
    // Raw points, not shares. Job role out of 80 and core values out of
    // 20 keep the lines apart on the plot; converting both to
    // percentages would stack three lines in the seventies.
    const avg = (rows: KpiSubmission[], pick: (s: KpiSubmission) => number | null) => {
      const vals = rows.map(pick).filter((v): v is number => v !== null)
      return vals.length
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : null
    }
    return openFyMonths(fy).map(m => {
      const rows = byMonth.get(m) ?? []
      return {
        month: m,
        total: avg(rows, s => s.final_total_score),
        job: avg(rows, s => s.final_job_role_score),
        esms: avg(rows, s => s.final_esms_score),
        core: avg(rows, s => s.final_core_score),
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

  /**
   * Is this month one that person's KPI covers?
   *
   * A June joiner was counted as "not submitted" for April and May, which
   * is a chase list with two names on it that nobody can act on. Read off
   * their own assignment, so it answers per person and per month.
   */
  const inScope = (memberId: string) => {
    const from = assignById.get(memberId)?.starts_from
    return !from || month >= from
  }

  const covered = team.filter(t => inScope(t.id))
  const waiting = covered.filter(t => subsById.get(t.id)?.status === 'submitted')
  const awaiting = waiting.length
  const notStarted = covered.filter(t => {
    const s = subsById.get(t.id)
    return !s || s.status === 'draft'
  }).length
  const done = covered.filter(t => SCORED.has(subsById.get(t.id)?.status ?? '')).length

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

      <TeamBands share={bandShare} label={`Team average by band · FY ${fy}`} />

      <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-3">
        <StatTile
          label="Waiting for my score"
          value={awaiting}
          tone={awaiting > 0 ? 'brand' : 'default'}
        />
        <StatTile label="Not submitted yet" value={notStarted} />
        {/* Out of the people this month applies to, not out of the whole
            team — otherwise a fully scored month reads as 14 of 16
            because two of them had not joined yet. */}
        <StatTile
          label="Scored"
          value={done}
          sub={covered.length === team.length
            ? `of ${team.length}`
            : `of ${covered.length} · ${team.length - covered.length} start later`}
        />
      </div>

      {/* Two views of the same scores, answering different questions:
          are we improving, and are we bunched or spread. Tabs rather
          than two stacked cards — they are alternatives, and a manager
          reads one at a time. */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex rounded-lg bg-ink-100 p-0.5"
            role="tablist"
            aria-label="Team chart"
          >
            {([
              ['trend', 'Team average', LineChartIcon],
              ['bell', 'Bell curve', Sigma],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={chartTab === key}
                onClick={() => setChartTab(key)}
                className={clsx(
                  'btn-press flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  chartTab === key
                    ? 'bg-white text-ink-900 shadow-sm'
                    : 'text-ink-500 hover:text-ink-800',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Only the bell curve's own filters, and only when it is the
              one on screen. Full width on a phone so two selects never
              end up squeezed into half a row each. */}
          {chartTab === 'bell' && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <select
                className="input w-full sm:w-auto"
                value={bellMonth}
                onChange={e => setBellMonth(e.target.value)}
                aria-label="Month"
              >
                <option value="">All months · average</option>
                {openFyMonths(fy).reverse().map(m => (
                  <option key={m} value={m}>{monthLabel(m)} only</option>
                ))}
              </select>
              <select
                className="input w-full sm:w-auto"
                value={bellMetric}
                onChange={e => setBellMetric(e.target.value as BellMetric)}
                aria-label="Which band to plot"
              >
                <option value="total">Total</option>
                <option value="job">Job role</option>
                {bandShare.anyEsms && <option value="esms">ESMS</option>}
                <option value="core">Core values</option>
              </select>
            </div>
          )}
        </div>

        <p className="mb-3 mt-3 text-xs text-ink-500">
          {chartTab === 'trend'
            ? 'Everyone who was scored that month, averaged, on the band scale.'
            : `Where the team sits on ${METRIC_LABEL[bellMetric].toLowerCase()}, ` +
              `${bellMonth ? `for ${monthLabel(bellMonth)}` : 'averaged over the year'}. ` +
              'Each dot on the axis is one person.'}
        </p>

        {chartTab === 'trend' ? (
          <BandTrend
            points={trend}
            hasEsms={bandShare.anyEsms}
            emptyMessage="No months scored yet — the lines start with your first one."
          />
        ) : (
          <BellCurve
            values={bellValues}
            emptyMessage={
              bellMonth
                ? `Fewer than three people have been scored for ${monthLabel(bellMonth)}, so there is no spread to draw yet.`
                : 'Fewer than three people have been scored yet, so there is no spread to draw.'
            }
          />
        )}
      </div>

      {peek && (
        <MemberPeek
          member={team.find(t => t.id === peek)!}
          sub={subsById.get(peek)}
          assign={assignById.get(peek)}
          month={month}
          queried={queried}
          onClose={() => setPeek(null)}
          onRemovePhoto={() => { setPeek(null); setPhotoFor(peek) }}
        />
      )}

      {photoFor && (
        <PhotoRemovalForm
          member={team.find(t => t.id === photoFor)!}
          onClose={() => setPhotoFor(null)}
          onDone={name => {
            setPhotoFor(null)
            setNotice(`${name}'s photo has been removed. They are told why.`)
          }}
        />
      )}

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
          // The month this KPI begins, when that is still ahead of the
          // month being shown — null the rest of the time, which is most
          // of the time.
          const startsLater = assign?.starts_from && month < assign.starts_from
            ? assign.starts_from
            : null

          return (
            <div key={member.id} className="flex items-center gap-3 p-4 hover:bg-ink-50">
              {/* The face and the name are one target, opening a quick
                  look rather than a page. The chevron beside them still
                  goes to the full record — a peek and a visit are
                  different intentions and deserve different buttons. */}
              <button
                onClick={() => setPeek(member.id)}
                className="btn-press flex min-w-0 flex-1 items-center gap-3 text-left"
                aria-label={`Quick look at ${member.full_name}`}
              >
                <Avatar name={member.full_name} src={member.avatar} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {member.full_name}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {member.ecode}
                    {member.designation && ` · ${member.designation}`}
                  </span>
                  {assign?.status !== 'active' && (
                    <span className="mt-1 block text-xs text-amber-700">
                      KPI {assign ? assign.status.replace('_', ' ') : 'not set up'}
                    </span>
                  )}
                </span>
              </button>

              <div className="hidden text-right sm:block">
                {startsLater ? (
                  <span className="badge bg-ink-100 text-ink-500">
                    From {monthLabel(startsLater)}
                  </span>
                ) : (
                  <StatusBadge
                    status={sub?.status ?? null}
                    queried={!!sub && !!queried?.has(sub.id)}
                  />
                )}
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
 * A quick look at one person, without leaving the list.
 *
 * The chevron beside each row already goes to their full record. Most of
 * the time a manager does not want the record — they want to remember
 * who this is and how the month is going, and a page load in and a page
 * load back for that is why nobody ever clicks.
 *
 * A dialog rather than a hover card: this list is used on a phone as
 * much as a desktop, and a hover card is nothing on a phone.
 */
function MemberPeek({
  member, sub, assign, month, queried, onClose, onRemovePhoto,
}: {
  member: Employee
  sub: KpiSubmission | undefined
  assign: KpiAssignment | undefined
  month: string
  /** Months with a question hanging over them — see useOpenQueryMonths. */
  queried: Set<string> | undefined
  onClose: () => void
  onRemovePhoto: () => void
}) {
  // Escape closes it, because a dialog that only closes by aiming at a
  // small × is a dialog people feel trapped in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const esms = Number(assign?.esms_weight ?? 0)
  const final = sub ? SCORED.has(sub.status) : false
  const rows: Array<[string, React.ReactNode]> = [
    ['Employee code', member.ecode],
    ['Designation', member.designation],
    ['Department', member.department],
    ['Function', member.function_name],
    ['Grade', member.grade],
    // The badge rather than the raw column: status.replace('_', ' ') put
    // "active" and "pending approval" on screen in database spelling,
    // which is not what any of these are called anywhere else in the app.
    ['KPI for the year', assign
      ? <StatusBadge status={assign.status} kind="assignment" />
      : <span className="text-amber-700">Not set up</span>],
    ['KPI starts from', assign
      ? (assign.starts_from
          ? monthLabel(assign.starts_from)
          : <span className="text-amber-700">Not set yet</span>)
      : '—'],
  ]

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`About ${member.full_name}`}
    >
      {/* Full width and bottom-anchored on a phone, a card on a desktop.
          Stops the click so tapping inside does not close it. */}
      <div
        className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <Avatar name={member.full_name} src={member.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-ink-900">{member.full_name}</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {member.designation ?? member.ecode}
            </p>
            <div className="mt-2">
              <StatusBadge
                status={sub?.status ?? null}
                queried={!!sub && !!queried?.has(sub.id)}
              />
            </div>
          </div>
          <button onClick={onClose} className="btn-icon shrink-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-ink-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-label text-ink-400">
            {monthLabel(month)}
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            <ScorePill value={sub?.final_total_score ?? sub?.self_total_score} size="lg" />
            <SectionSplit sub={sub} hasEsms={esms > 0} />
          </div>
          {sub && !final && (
            <p className="mt-1.5 text-xs text-ink-500">
              Self assessment only — not scored yet.
            </p>
          )}
        </div>

        <dl className="mt-4 divide-y divide-ink-100 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-4 py-2">
              <dt className="w-36 shrink-0 text-xs font-semibold uppercase tracking-label text-ink-500">
                {k}
              </dt>
              <dd className="min-w-0 flex-1 text-ink-900">
                {v ?? <span className="text-ink-300">—</span>}
              </dd>
            </div>
          ))}
        </dl>

        {/* A grid, not flex-wrap. Three buttons in a 448px dialog
            left one stranded on its own row at half width, which reads
            as a mistake; grid-fill gives an odd last child the full
            width so the shape is deliberate either way. */}
        <div className="grid-fill mt-4 grid grid-cols-2 gap-2">
          <Link to={`/team/${member.id}`} className="btn-primary">
            Full record <ChevronRight className="h-4 w-4" />
          </Link>
          {sub?.status === 'submitted' && (
            <Link to={`/score/${sub.id}`} className="btn-secondary">
              Score {monthLabel(month)}
            </Link>
          )}
          {member.avatar && (
            <button onClick={onRemovePhoto} className="btn-secondary !text-cyrixRed-700">
              <ImageOff className="h-4 w-4" /> Remove photo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Taking a photo down.
 *
 * A reason is required, and the person is shown it on their own profile
 * — the screen they would go to in order to put another one up. A
 * picture that silently disappears is how somebody concludes the app
 * lost it.
 */
function PhotoRemovalForm({
  member, onClose, onDone,
}: {
  member: Employee
  onClose: () => void
  onDone: (name: string) => void
}) {
  const remove = useRemoveAvatar()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    try {
      await remove.mutateAsync({ employeeId: member.id, reason })
      onDone(member.full_name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that photo.')
    }
  }

  return (
    <div className="card space-y-3 border-cyrixRed-200 p-4">
      <div>
        <h3 className="font-medium text-ink-900">
          Remove {member.full_name}'s photo?
        </h3>
        <p className="mt-0.5 text-sm text-ink-500">
          They will see your reason on their own profile and can upload
          another one.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <input
        className="input"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="e.g. Please use a clear photo of your face, without sunglasses"
        autoFocus
      />

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!reason.trim() || remove.isPending}
          className="btn-danger"
        >
          {remove.isPending && <Spinner className="h-4 w-4" />}
          Remove the photo
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
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
