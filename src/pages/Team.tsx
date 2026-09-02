import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Users, ChevronRight, Download, BarChart3, UserMinus, Spline, X, ImageOff, AlertCircle,
  Sigma, CalendarDays, LineChart as LineChartIcon,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  useTeamMonth, useTeamSubmissions, useRemovalAction, useRemoveAvatar,
  useSettleDueMonths, useOpenQueryMonths, useTeamSubtree, currentFy,
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
import TeamDrill from '@/components/TeamDrill'
import { useAmbientScore } from '@/contexts/ScoreThemeContext'
import type { KpiSubmission, KpiAssignment, Employee } from '@/types/db'

const SCORED = new Set(['scored', 'finalized'])

/**
 * The filter's own idea of status, which is coarser than the database's.
 *
 * A manager looking down a list wants four groups, not six: a month that
 * has been scored and one that has since been finalised are the same
 * answer to "is this done", and no submission row at all and a draft
 * one are both "they have not sent it".
 */
type StatusKey = 'all' | 'not_started' | 'draft' | 'submitted' | 'scored'

function statusKeyOf(status: string | null): Exclude<StatusKey, 'all'> {
  if (!status) return 'not_started'
  if (SCORED.has(status)) return 'scored'
  if (status === 'submitted') return 'submitted'
  // 'returned' sits with draft: it is back in their hands either way.
  return 'draft'
}

/**
 * The same colours the badges use, so the filter and the rows it filters
 * are obviously the same idea. Every ramp flips with the theme.
 */
const STATUS_FILTERS: { key: StatusKey; label: string; activeCls: string }[] = [
  { key: 'all',         label: 'Everyone',        activeCls: 'bg-ink-800 text-onInk' },
  { key: 'not_started', label: 'Not started',     activeCls: 'bg-ink-300 text-ink-900' },
  { key: 'draft',       label: 'Draft',           activeCls: 'bg-violet-200 text-violet-900' },
  { key: 'submitted',   label: 'Awaiting my score', activeCls: 'bg-amber-200 text-amber-900' },
  { key: 'scored',      label: 'Scored',          activeCls: 'bg-emerald-200 text-emerald-900' },
]

/** Which band the bell curve is plotting. */
type BellMetric = 'total' | 'job' | 'esms' | 'core'

const METRIC_LABEL: Record<BellMetric, string> = {
  total: 'Total',
  job: 'Job role',
  esms: 'ESMS',
  core: 'Core values',
}

/**
 * Where each band's axis starts when nobody is below it.
 *
 * A scored team lives in the top part of its band, so starting every
 * chart at zero spends half the width drawing an empty floor. These are
 * the points below which somebody would be a genuine outlier — and the
 * axis drops past them on its own when there is one.
 */
const BELL_FLOOR: Record<BellMetric, number> = {
  total: 40, job: 20, core: 0, esms: 0,
}

export default function Team() {
  const { employee } = useAuth()
  const fy = currentFy()
  const [month, setMonth] = useState(currentReportingMonth())
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [peek, setPeek] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all')
  /** Whose team is being looked into, null when nobody's. */
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null)
  const [askScope, setAskScope] = useState(false)
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
  // Only for the report counts and the 'everyone under me' figure. The
  // list itself still comes from useTeamMonth, which is the query the
  // rest of this page is built on.
  const { data: subtree } = useTeamSubtree(fy, month, null)

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
  const bell = useMemo(() => {
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

    // Their own average first, so somebody scored on six months is one
    // person on this chart rather than six.
    const people: Array<{ weight: number; value: number }> = []
    for (const member of data?.team ?? []) {
      const rows = (allSubs ?? []).filter(s =>
        s.employee_id === member.id
        && SCORED.has(s.status)
        && (!bellMonth || s.period_month === bellMonth))
      const vals = rows.map(pick).filter((v): v is number => v !== null)
      if (vals.length) {
        people.push({
          weight: weightsOf(member.id)[bellMetric],
          value: vals.reduce((a, b) => a + b, 0) / vals.length,
        })
      }
    }

    /*
      Points, not shares — core values is out of 20 and that is the
      number on everybody's screen, so an axis running to 100 was
      answering a question nobody asked.

      Except when the band is not the same size for the whole team.
      Core values is 20 for most people and 15 for anyone carrying ESMS,
      and plotting both as raw points would draw the 15s to the left of
      the 20s for reasons that have nothing to do with performance. That
      case falls back to shares, and the caption says so.
    */
    const weights = new Set(people.map(p => p.weight).filter(w => w > 0))
    const mixed = weights.size > 1
    const outOf = mixed ? 100 : ([...weights][0] ?? 100)

    return {
      mixed,
      outOf,
      floor: mixed ? 40 : BELL_FLOOR[bellMetric],
      values: people
        .map(p => (mixed ? attainmentPct(p.value, p.weight) : p.value))
        .filter((v): v is number => v !== null),
    }
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

  /** How many people are below this manager, beyond their own reports. */
  const wholeLine = subtree?.length ?? 0
  const reportsById = useMemo(
    () => new Map((subtree ?? []).filter(r => r.depth === 1).map(r => [r.employee_id, r.direct_reports])),
    [subtree],
  )

  /**
   * The file, for one of two audiences.
   *
   * 'direct' is built from what this page already holds. 'deep' cannot
   * be: the row policy on submissions is a single hop, so reading the
   * table for a division would come back quietly short rather than
   * refused. That one goes through the function that checks ancestry and
   * returns the whole line (migration 0083).
   */
  const download = async (scope: 'direct' | 'deep') => {
    setBusy(true); setError(null); setAskScope(false)
    try {
      if (scope === 'direct') {
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
      } else {
        const { data, error: rpcError } = await supabase.rpc('team_subtree_scores', {
          p_fy: fy, p_root: null, p_deep: true,
        })
        if (rpcError) throw new Error(rpcError.message)
        type Flat = Record<string, unknown> & { employee_id: string; period_month: string | null }
        const grouped = new Map<string, { employee: Employee; submissions: KpiSubmission[] }>()
        for (const raw of (data ?? []) as Flat[]) {
          let entry = grouped.get(raw.employee_id)
          if (!entry) {
            entry = {
              employee: {
                id: raw.employee_id,
                ecode: raw.ecode as string,
                full_name: raw.full_name as string,
                designation: raw.designation as string | null,
                department: raw.department as string | null,
              } as Employee,
              submissions: [],
            }
            grouped.set(raw.employee_id, entry)
          }
          // A person with no submission still comes back, once, with a
          // null month — they belong in the file as an empty row rather
          // than being left out of their own division's export.
          if (raw.period_month) entry.submissions.push(raw as unknown as KpiSubmission)
        }
        await exportKpiScores([...grouped.values()], fy, `Cyrix-KPI-whole-team-${fy}.xlsx`)
      }
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
      />

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
                    ? 'bg-surface text-ink-900 shadow-sm'
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
            : `Where the team sits on ${METRIC_LABEL[bellMetric].toLowerCase()}` +
              `${bell.mixed ? ', as a share of each person\'s own weightage' : ` out of ${bell.outOf}`}, ` +
              `${bellMonth ? `for ${monthLabel(bellMonth)}` : 'averaged over the year'}. ` +
              'Each dot on the axis is one person.' +
              (bell.mixed
                ? ' Shares rather than points here, because this band is not the same size for everyone on the team.'
                : '')}
        </p>

        {chartTab === 'trend' ? (
          <BandTrend
            points={trend}
            hasEsms={bandShare.anyEsms}
            emptyMessage="No months scored yet — the lines start with your first one."
          />
        ) : (
          <BellCurve
            values={bell.values}
            outOf={bell.outOf}
            floor={bell.floor}
            emptyMessage={
              bellMonth
                ? `Fewer than three people have been scored for ${monthLabel(bellMonth)}, so there is no spread to draw yet.`
                : 'Fewer than three people have been scored yet, so there is no spread to draw.'
            }
          />
        )}
      </div>

      {/*
        The line between the year and one month of it.

        The month picker lived in the hero, three cards above the only
        things it changed, so it read as a filter on the whole screen —
        and it is not: the score, the band split and both charts above
        are the whole year and do not move when it does. Sitting here it
        governs exactly what follows it, and the caption says so rather
        than leaving somebody to work it out by watching numbers fail to
        change.

        The two actions ride along because this is the row a manager
        reaches for when they are done reading and want to do something.
      */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100">
              <CalendarDays className="h-4 w-4 text-ink-500" />
            </span>
            <div className="min-w-0">
              <label
                htmlFor="team-month"
                className="block text-[11px] font-semibold uppercase tracking-label text-ink-400"
              >
                Showing
              </label>
              <select
                id="team-month"
                className="input mt-1 w-auto"
                value={month}
                onChange={e => setMonth(e.target.value)}
              >
                {/* Completed months only — a month in progress cannot be assessed. */}
                {openFyMonths(fy).reverse().map(m => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Two columns on a phone so they are equal width and neither
              strands the other on its own line. */}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Link to="/team/analysis" className="btn-analysis">
              <BarChart3 className="h-4 w-4" /> Team analysis
            </Link>
            {/* Only asks when the two answers differ. A manager whose
                reports manage nobody would be answering a question with
                one possible answer. */}
            <button
              onClick={() => (wholeLine > team.length ? setAskScope(true) : download('direct'))}
              className="btn-excel"
              disabled={busy}
            >
              {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              Export to Excel
            </button>
          </div>
        </div>
      </div>

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

      {/*
        The tiles above count; this narrows. They were the only way to ask
        "who has not submitted", and a count of sixteen against a list of
        sixteen names in no particular order is a number you then have to
        go and find. Each option carries its own count, so an empty one
        can be seen to be empty without being opened.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map(f => {
          const n = team.filter(m => statusKeyOf(subsById.get(m.id)?.status ?? null) === f.key).length
          if (f.key !== 'all' && n === 0) return null
          const count = f.key === 'all' ? team.length : n
          return (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              aria-pressed={statusFilter === f.key}
              className={clsx(
                'badge cursor-pointer transition-colors',
                statusFilter === f.key
                  ? f.activeCls
                  : 'bg-ink-100 text-ink-600 hover:bg-ink-200',
              )}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
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

      {/*
        Whoever is waiting on this manager comes first.

        The list was alphabetical, so a submission needing a score sat
        wherever the name fell -- somewhere down a list of two hundred, in
        a row that looked like every other row. The count at the top said
        how many were waiting and the list would not say which. Order and
        a marking on the row itself are what answer that; the count only
        ever raised the question.
      */}
      <div className="card divide-y divide-ink-100 overflow-hidden">
        {[...team]
          .filter(m =>
            statusFilter === 'all'
            || statusKeyOf(subsById.get(m.id)?.status ?? null) === statusFilter)
          .sort((a, b) => {
            const rank = (id: string) => (subsById.get(id)?.status === 'submitted' ? 0 : 1)
            return rank(a.id) - rank(b.id)
          })
          .map(member => {
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
            <div
              key={member.id}
              className={clsx(
                'flex items-center gap-3 p-4',
                // Tinted and edged where the manager is the one holding
                // things up, so the row is findable while scrolling rather
                // than only once it is read.
                needsScoring
                  ? 'border-l-4 border-amber-500 bg-amber-50/60 pl-3 hover:bg-amber-50'
                  : 'hover:bg-ink-50',
              )}
            >
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
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-ink-900">
                      {member.full_name}
                    </span>
                    {needsScoring && (
                      <AlertCircle
                        className="h-4 w-4 shrink-0 text-amber-600"
                        aria-label="Waiting for your score"
                      />
                    )}
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

              {/*
                View team, then status, then the score.

                It sat after the score and appeared only on rows that had
                a team, so every row sized itself differently and the
                badges and figures wandered left and right down the list.
                The slot is here on every row now, empty where there is
                nobody to look at, which is what keeps the columns
                underneath each other.
              */}
              {/* Narrow and icon-only on a phone rather than hidden: a
                  manager reading this on the road still needs to get into
                  a report's team, and the count is the part that has to
                  survive the squeeze. */}
              <div className="w-10 shrink-0 sm:w-[104px]">
                {(reportsById.get(member.id) ?? 0) > 0 && (
                  <button
                    onClick={() => setDrill({ id: member.id, name: member.full_name })}
                    className="btn w-full border border-ink-200 bg-surface !px-1.5 !py-1.5 text-xs text-ink-700 hover:bg-ink-100 sm:!px-2"
                    title={`See who reports to ${member.full_name}`}
                    aria-label={`View ${member.full_name}'s team of ${reportsById.get(member.id)}`}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">View team</span>
                    <span className="tabular-nums opacity-70">
                      {reportsById.get(member.id)}
                    </span>
                  </button>
                )}
              </div>

              <div className="hidden w-36 shrink-0 text-right sm:block">
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

      {drill && (
        <TeamDrill
          root={drill}
          fy={fy}
          month={month}
          onClose={() => setDrill(null)}
        />
      )}

      {/*
        Two files, two audiences, and the counts are shown rather than
        described — "everyone under you" means nothing until it says 187.
      */}
      {askScope && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-shade/60 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-ink-200 bg-surface p-5 shadow-2xl">
            <div>
              <h4 className="font-semibold text-ink-900">Who should the file cover?</h4>
              <p className="mt-1 text-sm text-ink-600">
                Some of your team manage people of their own.
              </p>
            </div>

            <button
              onClick={() => download('direct')}
              className="w-full rounded-xl border border-ink-200 p-4 text-left hover:border-brand-300 hover:bg-brand-50/50"
            >
              <p className="font-medium text-ink-900">
                My direct reports
                <span className="ml-2 tabular-nums text-ink-500">{team.length}</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                The {team.length} people on this screen.
              </p>
            </button>

            <button
              onClick={() => download('deep')}
              className="w-full rounded-xl border border-ink-200 p-4 text-left hover:border-brand-300 hover:bg-brand-50/50"
            >
              <p className="font-medium text-ink-900">
                Everyone under me
                <span className="ml-2 tabular-nums text-ink-500">{wholeLine}</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Their teams as well, all the way down.
              </p>
            </button>

            <div className="flex justify-end">
              <button onClick={() => setAskScope(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-shade/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`About ${member.full_name}`}
    >
      {/* Full width and bottom-anchored on a phone, a card on a desktop.
          Stops the click so tapping inside does not close it. */}
      <div
        className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
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
