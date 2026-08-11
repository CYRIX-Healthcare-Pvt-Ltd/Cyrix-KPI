import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Trophy, TrendingDown, AlertTriangle, Users, Download, ArrowUp, ArrowDown,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMyTeam, useTeamSubmissions, useTeamAssignments, useWeakAreas,
  useKraAttainment, useManagerMonthStatus, currentFy,
} from '@/lib/queries'
import { MonthStatusTable, MonthStatusLegend } from '@/components/MonthStatus'
import { fyMonths, openFyMonths, monthLabel, isMonthOpen } from '@/lib/fy'
import { bandFor, isWeak, trendOf, attainmentPct, teamBandShare } from '@/lib/bands'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL, SECTION_SHORT } from '@/lib/sections'
import { exportOrgStatus } from '@/lib/export'
import { PageLoader, ScorePill, StatTile, EmptyState, Alert } from '@/components/ui'
import { ScoreHeader, TrendChip, BandChip, TeamBands } from '@/components/analysis'
import type { Employee, WeakAreaRow, Section } from '@/types/db'

const SCORED = new Set(['scored', 'finalized'])

/**
 * Which band the table is reporting on.
 *
 * 'all' shows every band this team carries side by side. Picking one
 * narrows the table to that band alone — and the ranking with it, which
 * is the point: "who is best" is a different question for job role than
 * it is for the total, and a team's best performer on paper is sometimes
 * the fourth-best at the actual job.
 */
type Metric = 'all' | 'total' | 'job' | 'esms' | 'core'

const METRIC_LABEL: Record<Exclude<Metric, 'all'>, string> = {
  total: 'Total',
  job: 'Job role',
  esms: 'ESMS',
  core: 'Core values',
}

/** What the rank and the default sort follow, per selected band. */
const RANK_BY: Record<Metric, Exclude<Metric, 'all'>> = {
  all: 'total', total: 'total', job: 'job', esms: 'esms', core: 'core',
}

type SortKey = Exclude<Metric, 'all'> | 'name' | 'months'

/**
 * A section score as a share of the weightage it was out of.
 *
 * Everything comparable in this table goes through here. Scoring 16 out
 * of a 20-point core-values band and 14 out of a 15-point one are 80%
 * and 93%, and the raw figures put them the other way round — which is
 * how the band chip came to call a perfect job-role month "Very Good"
 * and a strong core-values month "Poor".
 */
const share = (p: PersonRow, key: Exclude<Metric, 'all'>) =>
  attainmentPct(p[key], p.weights[key])

/** The same share, rounded for a spreadsheet cell. Blank, never zero. */
const pctCell = (v: number | null, outOf: number) => {
  const pct = attainmentPct(v, outOf)
  return pct === null ? '' : Math.round(pct * 10) / 10
}

interface PersonRow {
  member: Employee
  hasEsms: boolean
  total: number | null
  job: number | null
  esms: number | null
  core: number | null
  /**
   * What each of those is out of. Job role is 80 for everyone; core
   * values is 20, or 15 for the people who also carry ESMS. The raw
   * scores are therefore not comparable across people, and 16 of 20 next
   * to 14 of 15 is the case that proves it.
   */
  weights: Record<Exclude<Metric, 'all'>, number>
  months: number
  /** Across the whole year, whatever month is selected — a trend of one
   *  month is not a trend, so the column hides when a month is pinned. */
  series: Array<number | null>
  weakAreas: WeakAreaRow[]
}

export default function TeamAnalysis() {
  const { employee } = useAuth()
  const fy = currentFy()

  const [month, setMonth] = useState<string>('')      // '' = every month
  const [metric, setMetric] = useState<Metric>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [asc, setAsc] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const { data: team, isLoading } = useMyTeam(employee?.id)
  const ids = useMemo(() => (team ?? []).map(t => t.id), [team])
  const { data: subs } = useTeamSubmissions(ids.length ? ids : undefined, fy)
  const { data: kpis } = useTeamAssignments(ids.length ? ids : undefined, fy)
  const assignments = kpis?.assignments
  const { data: weak } = useWeakAreas(ids.length ? ids : undefined, fy)
  // Month by month, KRA by KRA — the only shape that can answer "which
  // area is slipping" rather than "who is low".
  const { data: attainment } = useKraAttainment(ids.length ? ids : undefined, fy)
  // The year average says how the team is doing; this says which months
  // are actually finished, which is the other half of the question.
  const { data: byMonth } = useManagerMonthStatus(fy, {
    managerId: employee?.id,
    enabled: !!employee?.id,
  })

  const analysis = useMemo(() => {
    if (!team || !subs) return null
    const months = fyMonths(fy)
    const weightBy = new Map(
      (assignments ?? []).map(a => [a.employee_id, {
        total: 100,
        job: Number(a.job_role_weight ?? JOB_ROLE_TOTAL),
        esms: Number(a.esms_weight ?? 0),
        core: Number(a.core_values_weight ?? REMAINDER_TOTAL),
      }]),
    )
    const DEFAULT_WEIGHTS = {
      total: 100, job: JOB_ROLE_TOTAL, esms: 0, core: REMAINDER_TOTAL,
    }

    const people: PersonRow[] = team.map(member => {
      const scored = subs.filter(s => s.employee_id === member.id && SCORED.has(s.status))
      const byPeriod = new Map(scored.map(s => [s.period_month, s]))
      const series = months.map(m => byPeriod.get(m)?.final_total_score ?? null)

      // One month or all of them, from the same rows — so the two
      // readings can never disagree about what a month was worth.
      const inScope = month ? scored.filter(s => s.period_month === month) : scored
      const mean = (pick: (s: typeof scored[number]) => number | null) => {
        const vals = inScope.map(pick).filter((v): v is number => v !== null)
        return vals.length
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          : null
      }

      const weights = weightBy.get(member.id) ?? DEFAULT_WEIGHTS
      return {
        member,
        hasEsms: weights.esms > 0,
        weights,
        total: mean(s => s.final_total_score),
        job: mean(s => s.final_job_role_score),
        esms: mean(s => s.final_esms_score),
        core: mean(s => s.final_core_score),
        months: inScope.length,
        series,
        weakAreas: (weak ?? []).filter(
          w => w.employee_id === member.id && isWeak(w.avg_attainment_pct),
        ),
      }
    })

    const rated = people.filter(p => p.total !== null)
    const teamAvg = rated.length
      ? Math.round((rated.reduce((a, p) => a + (p.total ?? 0), 0) / rated.length) * 10) / 10
      : null

    return {
      people,
      teamAvg,
      anyEsms: people.some(p => p.hasEsms),
      // Each person's figures are already averaged over whatever the
      // month filter selected, so one entry each is exactly the
      // per-person-then-team averaging the total above uses. It also
      // means the split follows the filter rather than quietly
      // reporting the whole year underneath a single-month table.
      bandShare: teamBandShare(people.map(p => ({
        weights: { job: p.weights.job, esms: p.weights.esms, core: p.weights.core },
        months: [{ job: p.job, esms: p.esms, core: p.core, total: p.total }],
      }))),
      best: [...rated].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 5),
      struggling: [...rated]
        .filter(p => isWeak(p.total))
        .sort((a, b) => (a.total ?? 0) - (b.total ?? 0)),
      declining: rated.filter(p => trendOf(p.series)?.direction === 'down'),
      unscored: people.filter(p => p.total === null).length,
    }
  }, [team, subs, assignments, weak, fy, month])

  /**
   * Named areas that need a conversation, and why.
   *
   * "Nobody is averaging below Good" was true and useless: somebody can
   * average 84 and still be sliding on one KRA, or be a long way behind
   * the rest of the team on the one thing they share. A manager cannot
   * act on a total; they can act on "Athul, Board Repair, falling".
   *
   * Two signals, deliberately different questions:
   *
   *   FALLING   the last two months against the two before, on that KRA
   *             alone — their own trend, nobody else involved.
   *   BEHIND    their average against everybody else on the team who
   *             carries a KRA of the same name.
   *
   * The peer comparison is by name, which is the only handle there is,
   * and it is why the count of peers is printed rather than hidden: a
   * manager's reports can hold different job roles, and two people can
   * mean different things by the same words. Naming "the other 4" lets
   * the reader discount it. Core values compare cleanly — that row is
   * identical for everyone who has it.
   */
  const concerns = useMemo(() => {
    if (!attainment || !team) return []
    const byId = new Map(team.map(t => [t.id, t]))

    /*
      Per person per KRA, in month order.

      The value carries the employee, the KRA and the section, because
      the first version of this built a key of "<id> <kra>" and split it
      back on a space — which turned "Customer Delight" into "Customer"
      and put a KRA that does not exist on screen. A composite key is
      fine; recovering its parts by parsing is not.
    */
    const series = new Map<string, {
      employeeId: string; kra: string; section: string
      rows: Array<{ month: string; pct: number }>
    }>()

    for (const r of attainment) {
      if (r.attainment_pct === null || !SCORED.has(r.status)) continue
      const key = `${r.employee_id} ${r.kra}`
      const entry = series.get(key)
        ?? { employeeId: r.employee_id, kra: r.kra, section: r.section, rows: [] }
      entry.rows.push({ month: r.period_month, pct: r.attainment_pct })
      series.set(key, entry)
    }

    /*
      Every KRA a person is measured on this year, from the agreed KPI.

      Built from the assignment rather than from the scores, because the
      scores only cover months that have been done: somebody scored on
      one month has a smaller set than a colleague scored on four, so
      the two would be put in different groups despite having the same
      KPI — which is how one person's peer average came out at 85% and
      another's at 100% on the same KRA.
    */
    const kpiOf = new Map<string, Set<string>>()
    const assignmentOwner = new Map((kpis?.assignments ?? []).map(a => [a.id, a.employee_id]))
    for (const item of kpis?.items ?? []) {
      const owner = assignmentOwner.get(item.assignment_id)
      if (!owner) continue
      const set = kpiOf.get(owner) ?? new Set<string>()
      set.add(item.kra)
      kpiOf.set(owner, set)
    }

    /*
      Who is comparable to whom.

      Only people whose whole KPI is the same set of KRAs. Matching one
      KRA name at a time was the first attempt and it is not safe here: a
      manager's reports can hold different job roles, two of them can use
      the same words for different work, and a comparison built on that
      produces a number that looks precise and is not. Identical KPIs are
      genuinely the same job, so the comparison means what it says.
    */
    const fingerprint = new Map<string, string>()
    for (const [id, set] of kpiOf) {
      fingerprint.set(id, [...set].sort().join(' | '))
    }
    const cohort = new Map<string, string[]>()
    for (const [id, fp] of fingerprint) {
      cohort.set(fp, [...(cohort.get(fp) ?? []), id])
    }

    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
    const out: Array<{
      member: Employee; kra: string; section: string; why: string; avg: number
      months: number; peers: number; peerAvg: number | null; rank: number
    }> = []

    for (const { employeeId, kra, section, rows } of series.values()) {
      const member = byId.get(employeeId)
      if (!member || rows.length === 0) continue

      const ordered = [...rows].sort((a, b) => a.month.localeCompare(b.month))
      const mine = ordered.map(r => r.pct)
      const avg = mean(mine)
      const trend = trendOf(mine)

      // The same KRA, read only off people doing the same job.
      const sameKpi = (cohort.get(fingerprint.get(employeeId) ?? '') ?? [])
        .filter(id => id !== employeeId)
      const peerRows = (id: string) => series.get(`${id} ${kra}`)?.rows ?? []
      const peerReadings = sameKpi.flatMap(id => peerRows(id).map(r => r.pct))
      const peers = sameKpi.filter(id => peerRows(id).length > 0).length
      const peerAvg = peerReadings.length ? mean(peerReadings) : null
      const gap = peerAvg === null ? null : avg - peerAvg

      const falling = trend?.direction === 'down'
      // Five points is roughly a band boundary at this scale, so anything
      // smaller is noise dressed as a finding.
      // Two others at least. "The 1 other with the same KPI average
      // 100%" is not an average — it is one colleague's score with a
      // word in front of it, and it moves wildly on one more month.
      const behind = gap !== null && gap < -5 && peers >= 2

      if (!falling && !behind && !isWeak(avg)) continue

      const why = falling && behind
        ? `Falling ${Math.abs(trend!.delta).toFixed(0)} points, and ${Math.abs(gap!).toFixed(0)} behind the others doing this job`
        : falling
        ? `Falling ${Math.abs(trend!.delta).toFixed(0)} points over the last two months`
        : behind
        ? `${Math.abs(gap!).toFixed(0)} points behind the others doing this job`
        : 'Averaging below Good on this area'

      out.push({
        member, kra, section, why, avg, months: mine.length, peers, peerAvg,
        // Falling first, then furthest behind. A slide is still
        // happening; a gap may be a job somebody simply finds hard.
        rank: (falling ? 0 : 100) + (gap === null ? 50 : Math.max(0, 50 + gap)),
      })
    }

    return out.sort((a, b) => a.rank - b.rank).slice(0, 8)
  }, [attainment, team, kpis])

  /**
   * The ranking, and then the order.
   *
   * Rank is always on the selected band — it is the number the filter
   * asked about. Sorting is separate: you can rank on job role and then
   * sort by name to find somebody, and their rank travels with them
   * rather than being recomputed from where the row happens to sit.
   */
  const rows = useMemo(() => {
    if (!analysis) return []
    const by = RANK_BY[metric]
    // Ranked on the share earned, not the raw score — see share().
    const ranked = [...analysis.people]
      .map(p => ({ ...p, pct: share(p, by) }))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
      .map((p, _i, all) => ({
        ...p,
        // Ties share a place, and nobody unscored gets one at all.
        rank: p.pct === null
          ? null
          : (all.findIndex(o => o.pct === p.pct) + 1),
      }))

    if (!sortKey) return ranked

    const value = (p: typeof ranked[number]) =>
      sortKey === 'name' ? p.member.full_name.toLowerCase()
      : sortKey === 'months' ? p.months
      : share(p, sortKey)

    return [...ranked].sort((a, b) => {
      const x = value(a), y = value(b)
      if (typeof x === 'string' && typeof y === 'string') {
        return asc ? x.localeCompare(y) : y.localeCompare(x)
      }
      // Unscored last whichever way the column is pointing: a column of
      // dashes at the top is not a sort, it is the sort giving up.
      const nx = x === null ? null : Number(x)
      const ny = y === null ? null : Number(y)
      if (nx === null && ny === null) return 0
      if (nx === null) return 1
      if (ny === null) return -1
      return asc ? nx - ny : ny - nx
    })
  }, [analysis, metric, sortKey, asc])

  const showEsms = (analysis?.anyEsms ?? false) &&
    (metric === 'all' || metric === 'esms')
  const showCols = {
    total: metric === 'all' || metric === 'total',
    job: metric === 'all' || metric === 'job',
    esms: showEsms,
    core: metric === 'all' || metric === 'core',
  }

  const scopeLabel = month ? monthLabel(month) : 'every scored month'

  const download = async () => {
    setExportError(null)
    try {
      await exportOrgStatus(
        rows.map(p => ({
          Rank: p.rank ?? '',
          Ecode: p.member.ecode,
          Name: p.member.full_name,
          Designation: p.member.designation ?? '',
          // The percentage travels with every score, because a column of
          // raw figures out of different denominators is a spreadsheet
          // somebody will sort and draw the wrong conclusion from.
          ...(showCols.job
            ? { 'Job role': p.job ?? '', 'Job role %': pctCell(p.job, p.weights.job) }
            : {}),
          ...(showCols.esms
            ? { ESMS: p.esms ?? '', 'ESMS %': pctCell(p.esms, p.weights.esms) }
            : {}),
          ...(showCols.core
            ? { 'Core values': p.core ?? '', 'Core values %': pctCell(p.core, p.weights.core) }
            : {}),
          ...(showCols.total ? { Total: p.total ?? '' } : {}),
          'Months scored': p.months,
          'Weak areas': p.weakAreas.map(w => w.kra).join('; '),
        })),
        `Cyrix-team-analysis-${fy}-${month ? monthLabel(month) : 'all-months'}` +
        `${metric === 'all' ? '' : `-${RANK_BY[metric]}`}.xlsx`,
        'Team analysis',
      )
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not build the export.')
    }
  }

  if (isLoading) return <PageLoader />

  if (!team || team.length === 0) {
    return (
      <EmptyState icon={Users} title="No team members">
        Nobody currently reports to you.
      </EmptyState>
    )
  }
  if (!analysis) return <PageLoader />

  const sortOn = (key: SortKey) => {
    if (sortKey === key) { setAsc(v => !v); return }
    setSortKey(key)
    // Names read A–Z; every score reads best-first.
    setAsc(key === 'name')
  }

  return (
    <div className="space-y-5">
      <ScoreHeader
        title="Team analysis"
        subtitle={`${team.length} team members · FY ${fy}`}
        score={analysis.teamAvg}
        scoreLabel="Team average"
      />

      <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-4">
        <StatTile
          label="Performing well"
          value={analysis.people.filter(p => (p.total ?? 0) >= 80).length}
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

      <TeamBands
        share={analysis.bandShare}
        label={`Team average by band · ${scopeLabel}`}
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">Month by month</h3>
          <MonthStatusLegend />
        </div>
        <MonthStatusTable
          mode="by-month"
          // Only months that have finished. August's KPI is submitted
          // during September, so listing August on 2 August shows a whole
          // team as outstanding for work that is not due yet.
          rows={(byMonth ?? []).filter(r => isMonthOpen(r.period_month))}
          emptyMessage="No months have finished yet."
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
                <PersonRowCard key={p.member.id} p={p} />
              ))}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-cyrixRed-600" />
            <h3 className="text-sm font-semibold text-ink-800">Needing support</h3>
          </div>
          {analysis.struggling.length === 0 && concerns.length === 0 ? (
            <p className="p-4 text-sm text-emerald-800">
              Nobody is averaging below Good, and no single area is slipping.
            </p>
          ) : (
            <div className="divide-y divide-ink-100">
              {analysis.struggling.map(p => (
                <PersonRowCard key={p.member.id} p={p} showWeak />
              ))}
              {/* Somebody can be averaging fine and still be sliding on one
                  thing, or be well behind the rest of the team on it. A
                  card that only listed people below Good said "nobody" to
                  a manager who had four of these. */}
              {concerns.map(c => (
                <div key={`${c.member.id}-${c.kra}`} className="p-3.5">
                  <p className="text-sm text-ink-900">
                    <Link
                      to={`/team/${c.member.id}`}
                      className="link-accent font-medium hover:underline"
                    >
                      {c.member.full_name}
                    </Link>
                    {' — '}
                    <span className="font-medium">{c.kra}</span>
                    <span className="ml-1.5 text-xs font-normal text-ink-400">
                      {SECTION_SHORT[c.section as Section] ?? c.section}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-cyrixRed-700">{c.why}</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {c.avg.toFixed(0)}% of the weightage over {c.months} month
                    {c.months === 1 ? '' : 's'}
                    {c.peers >= 2 && ` · the ${c.peers} others with the same KPI average ${c.peerAvg!.toFixed(0)}%`}
                  </p>
                </div>
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
              <PersonRowCard key={p.member.id} p={p} />
            ))}
          </div>
        </div>
      )}

      {/* No cross-team KRA chart here on purpose: a manager's reports can
          hold different job roles, so averaging "KRA3" across people who
          each mean something different by it produces a number that looks
          precise and means nothing. Weak areas are reported per person. */}

      <div className="card overflow-hidden">
        <div className="space-y-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-800">Everyone</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Ranked on {METRIC_LABEL[RANK_BY[metric]].toLowerCase()} across{' '}
                {scopeLabel}.
              </p>
            </div>
            <button onClick={download} className="btn-excel">
              <Download className="h-4 w-4" /> Export this view
            </button>
          </div>

          {/* Two controls, one row: what period, and which band. Both
              change the rank, because a ranking that ignored the filter
              above it would be answering a question nobody asked. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <select
              className="input w-full sm:w-auto"
              value={month}
              onChange={e => setMonth(e.target.value)}
              aria-label="Month"
            >
              <option value="">All months · average</option>
              {openFyMonths(fy).reverse().map(m => (
                <option key={m} value={m}>{monthLabel(m)} only</option>
              ))}
            </select>
            <select
              className="input w-full sm:w-auto"
              value={metric}
              onChange={e => {
                setMetric(e.target.value as Metric)
                setSortKey(null)
              }}
              aria-label="Which band to show"
            >
              <option value="all">All bands</option>
              <option value="job">Job role only</option>
              {analysis.anyEsms && <option value="esms">ESMS only</option>}
              <option value="core">Core values only</option>
              <option value="total">Total only</option>
            </select>
            {(month || metric !== 'all' || sortKey) && (
              <button
                onClick={() => { setMonth(''); setMetric('all'); setSortKey(null) }}
                className="col-span-2 text-xs font-medium text-ink-500 hover:text-ink-900 sm:col-auto"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {exportError && <div className="p-3"><Alert kind="error">{exportError}</Alert></div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-3 py-2.5 text-right font-medium">#</th>
                <SortHeader
                  label="Team member" col="name"
                  sortKey={sortKey} asc={asc} onSort={sortOn}
                />
                {showCols.job && (
                  <SortHeader
                    label="Job role" col="job" align="right"
                    sortKey={sortKey} asc={asc} onSort={sortOn}
                  />
                )}
                {showCols.esms && (
                  <SortHeader
                    label="ESMS" col="esms" align="right"
                    sortKey={sortKey} asc={asc} onSort={sortOn}
                  />
                )}
                {showCols.core && (
                  <SortHeader
                    label="Core values" col="core" align="right"
                    sortKey={sortKey} asc={asc} onSort={sortOn}
                  />
                )}
                {showCols.total && (
                  <SortHeader
                    label="Total" col="total" align="right"
                    sortKey={sortKey} asc={asc} onSort={sortOn}
                  />
                )}
                <th className="px-4 py-2.5 font-medium">Band</th>
                {!month && <th className="px-4 py-2.5 font-medium">Trend</th>}
                <SortHeader
                  label="Months" col="months" align="right"
                  sortKey={sortKey} asc={asc} onSort={sortOn}
                />
                <th className="px-4 py-2.5 font-medium">Weak areas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map(p => (
                <tr key={p.member.id} className="hover:bg-ink-50">
                  <td className="px-3 py-3 text-right tabular-nums">
                    {p.rank === null ? (
                      <span className="text-ink-300">—</span>
                    ) : (
                      <span className={clsx(
                        'font-semibold',
                        p.rank <= 3 ? 'text-ink-900' : 'text-ink-400',
                      )}>
                        {p.rank}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/team/${p.member.id}`}
                      className="link-accent text-ink-900 hover:underline"
                    >
                      {p.member.full_name}
                    </Link>
                    <p className="text-xs text-ink-500">{p.member.ecode}</p>
                  </td>
                  {showCols.job && (
                    <ScoreCell v={p.job} outOf={p.weights.job} />
                  )}
                  {showCols.esms && (
                    <ScoreCell v={p.esms} outOf={p.weights.esms} muted={!p.hasEsms} />
                  )}
                  {showCols.core && (
                    <ScoreCell v={p.core} outOf={p.weights.core} />
                  )}
                  {showCols.total && (
                    <ScoreCell v={p.total} outOf={100} pill />
                  )}
                  <td className="px-4 py-3">
                    <BandChip pct={p.pct} />
                  </td>
                  {!month && (
                    <td className="px-4 py-3"><TrendChip scores={p.series} /></td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                    {p.months}
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

        <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-400">
          Each band is scored out of its own weightage — job role out of 80,
          core values out of 20, or 15 for anyone who also carries ESMS. The
          rank and the band come from the percentage, not the raw score:
          14 out of 15 beats 16 out of 20.
        </p>
      </div>
    </div>
  )
}

/** A column header you can sort on, with the direction shown. */
function SortHeader({
  label, col, align = 'left', sortKey, asc, onSort,
}: {
  label: string
  col: SortKey
  align?: 'left' | 'right'
  sortKey: SortKey | null
  asc: boolean
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === col
  return (
    <th className={clsx('px-4 py-2.5 font-medium', align === 'right' && 'text-right')}>
      <button
        onClick={() => onSort(col)}
        className={clsx(
          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-900',
          active ? 'text-ink-900' : 'text-ink-500',
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active && (asc
          ? <ArrowUp className="h-3 w-3" />
          : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

/**
 * The score, and underneath it the share of the band that is.
 *
 * Both, because both are wanted and neither does the other's job: the
 * raw figure is what adds up to the total on every other screen, and the
 * percentage is the only thing comparable between a 20-point core-values
 * band and a 15-point one. It also quietly states the denominator, which
 * varies per person and so cannot live in the column header.
 */
function ScoreCell({
  v, outOf, pill, muted,
}: {
  v: number | null
  outOf: number
  pill?: boolean
  muted?: boolean
}) {
  const pct = attainmentPct(v, outOf)
  return (
    <td className="px-4 py-3 text-right">
      {v === null ? (
        <span className="text-ink-300" title={muted ? 'Not measured on this' : undefined}>
          —
        </span>
      ) : pill ? (
        <ScorePill value={v} outOf={outOf} size="sm" />
      ) : (
        <>
          <span className="font-medium tabular-nums text-ink-800">{v.toFixed(1)}</span>
          {pct !== null && (
            <p className="text-[11px] tabular-nums text-ink-400">
              {pct.toFixed(0)}% of {outOf}
            </p>
          )}
        </>
      )}
    </td>
  )
}

function PersonRowCard({
  p, showWeak,
}: {
  p: {
    member: { id: string; ecode: string; full_name: string }
    total: number | null
    series: Array<number | null>
    weakAreas: Array<{ kra: string; avg_attainment_pct: number | null }>
  }
  showWeak?: boolean
}) {
  const band = bandFor(p.total)
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <Link
          to={`/team/${p.member.id}`}
          className="link-accent text-ink-900 hover:underline"
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
        <ScorePill value={p.total} />
        {band && <p className={`mt-1 text-[11px] ${band.accent}`}>{band.label}</p>}
      </div>
    </div>
  )
}
