import { useLocation, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { ChevronRight, Crown, Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useSubmissionHistory, useAnnualSummary, useMyAssignment,
  useSettleDueMonths, useOpenQueryMonths, currentFy,
} from '@/lib/queries'
import {
  fyMonthsFrom, openFyMonthsFrom, monthLabel, isMonthOpen, currentReportingMonth,
} from '@/lib/fy'
import { useTeamStanding } from '@/lib/teamStanding'
import { GOLD } from '@/components/LegendCrest'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import { useIsDark } from '@/lib/isDark'
import { useNarrow } from '@/lib/useNarrow'
import {
  Alert, PageLoader, StatusBadge, ScorePill,
} from '@/components/ui'
import { ScoreLabel, TREND_MARGIN } from '@/components/ScoreTrend'
import { bandFor, bandScaleGradient } from '@/lib/bands'

const SCALE = bandScaleGradient()
import { ratingFor, ratingLabel } from '@/lib/rating'

export default function MyHistory() {
  const { employee } = useAuth()
  return <AssessmentYear employeeId={employee?.id} />
}

/**
 * One person's year: the average card with its graph, then the months. Mine on Assessments; a team member's on their
 * page for the manager (the user, 12 Nov: "why the changes we did is not showing?"), where a month opens for scoring.
 */
export function AssessmentYear({ employeeId, manager = false }: { employeeId: string | undefined; manager?: boolean }) {
  const navigate = useNavigate()
  const fy = currentFy()
  const dark = useIsDark()
  const ink = dark ? '#f4f5f7' : '#141519'
  // Team rank 1 in the month being assessed, as on the Dashboard (0262-0275; the user, 12 Nov: "we are 1, so dont
  // forgot gold"; "only the total score is gold enough"): the year average turns gold.
  const month = currentReportingMonth()
  const team = useTeamStanding(fy)
  const champ = manager ? null : team.data?.find(r => r.is_me && r.period_month?.slice(0, 10) === month && r.team_rank === 1 && (r.team_of ?? 0) > 1) ?? null
  // A phone: the graph's padding, labels and axis go smaller so seven months fit (the user, 12 Nov: "is padding too much?
  // and make font less so it fits").
  const narrow = useNarrow()
  const lf = narrow ? 9 : 11
  // The parts in colours of their own, and the total by how it moved (the user, 12 Nov: "core value line color can be
  // different, and job role dont need red, and total green yellow red based on rise").
  const JOB = dark ? '#60a5fa' : '#2563eb'
  const CORE = dark ? '#2dd4bf' : '#0d9488'
  const RISE = '#22c55e', FLAT = '#eab308', FALL = '#ef4444'
  const tick = { fontSize: narrow ? 10 : 12, fill: '#6b6e79' }
  // Carried here by the submission screen so the confirmation lands
  // beside the row that has just changed rather than on a page the
  // person is about to leave.
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const { data: history, isLoading } = useSubmissionHistory(employeeId, fy)
  useSettleDueMonths(!manager)
  const { data: queried } = useOpenQueryMonths(!manager)
  const { data: annual } = useAnnualSummary(employeeId, fy)
  // Which bands to print. Read off the assignment rather than off the
  // scores, so somebody who carries ESMS but has not been scored on it
  // yet still sees three figures with a dash in the middle, rather than
  // the split silently changing shape the month their first score lands.
  // Already in the query cache from the dashboard.
  const { data: assignment } = useMyAssignment(employeeId, fy)
  const esmsWeight = Number(assignment?.assignment?.esms_weight ?? 0)
  // The person rates their own core values too (0214, Ajith sir's team): only then is Self more than the job role.
  const selfRatesCore = assignment?.assignment?.core_self_rating === true
  const hasEsms = esmsWeight > 0
  const coreWeight = Number(
    assignment?.assignment?.core_values_weight ?? (REMAINDER_TOTAL - esmsWeight),
  )

  if (isLoading) return <PageLoader />

  const byMonth = new Map((history ?? []).map(s => [s.period_month, s]))
  // My month opens my month page; a team member's opens scoring, which comes back to their page.
  const go = (m: string) => {
    if (!manager) return navigate(`/submission/${m}`, { state: { from: 'history' } })
    const s = byMonth.get(m)
    if (s) navigate(`/score/${s.id}`, { state: { from: 'member', employeeId } })
  }

  // Months this KPI actually covers. A June joiner's history opened with
  // two empty rows that looked exactly like two months they had skipped.
  const startsFrom = assignment?.assignment?.starts_from ?? null

  const chartData = openFyMonthsFrom(fy, startsFrom)
    .map(m => {
      const s = byMonth.get(m)
      const scored = s && (s.status === 'scored' || s.status === 'finalized')
      return {
        month: monthLabel(m).split('-')[0],
        'Job role': scored ? s.final_job_role_score : null,
        ESMS: scored ? s.final_esms_score : null,
        'Core values': scored ? s.final_core_score : null,
        Total: scored ? s.final_total_score : null,
      }
    })

  const hasAnyScore = chartData.some(d => d.Total !== null)

  return (
    <div className="space-y-5">
      {notice && <Alert kind="success">{notice}</Alert>}

      {/* One card: the year average and what it is made of, beside the months as a line (the user, 12 Nov: "only
          year avg grid and graph", no band bar, no best / lowest / months-scored tiles; the graph's top and bottom
          month carry a green and an amber dot, numbers only). */}
      {(() => {
        const avg = annual?.avg_total_score ?? null
        const band = bandFor(avg)
        const rating = ratingFor(avg)
        const parts = [
          { label: 'Job role', value: annual?.avg_job_role_score, of: JOB_ROLE_TOTAL, colour: JOB },
          ...(hasEsms ? [{ label: 'ESMS', value: annual?.avg_esms_score, of: esmsWeight, colour: '#7c3aed' }] : []),
          { label: 'Core values', value: annual?.avg_core_values_score, of: coreWeight, colour: CORE },
          // How much of the year the average stands on (the user, 12 Nov: "after core value you can show 7/12").
          { label: 'Months scored', value: annual?.months_scored ?? 0, of: 12, colour: null as string | null, whole: true },
        ]
        // Each stretch of the total is green up, yellow held (within half a point), red down; a point takes the colour of
        // the stretch that reached it, the first that of the stretch leaving it.
        const pts = chartData.map((d, i) => ({ i, v: d.Total })).filter((x): x is { i: number; v: number } => x.v !== null)
        const move = (a: number, b: number) => (b - a > 0.5 ? RISE : a - b > 0.5 ? FALL : FLAT)
        const seg = pts.slice(1).map((x, k) => ({ from: pts[k].i, to: x.i, c: move(pts[k].v, x.v) }))
        const dotColour = new Map<number, string>()
        seg.forEach(g => dotColour.set(g.to, g.c))
        if (seg.length) dotColour.set(pts[0].i, seg[0].c)
        const span = pts.length > 1 ? pts[pts.length - 1].i - pts[0].i : 1
        const at = (i: number) => `${((i - (pts[0]?.i ?? 0)) / span) * 100}%`
        const TotalDot = (p: { cx?: number; cy?: number; value?: number | null; index?: number }) => {
          if (p.cx == null || p.cy == null || p.value == null) return <g key={p.index} />
          return <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={dotColour.get(p.index ?? -1) ?? ink} stroke={ink} strokeWidth={1} />
        }
        return (
          <div className={`card grid overflow-hidden ${hasAnyScore ? 'lg:grid-cols-[240px_minmax(0,1fr)]' : ''}`}>
            <div className={`flex flex-col gap-4 p-5 ${hasAnyScore ? 'border-ink-200 sm:border-b lg:border-b-0 lg:border-r' : ''}`}>
              <div className="flex items-start justify-between gap-3 lg:flex-col lg:items-stretch">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-label text-ink-500">Year average</p>
                  <p className="text-xs text-ink-500">FY {fy}</p>
                  <p className={`mt-2 whitespace-nowrap text-5xl font-bold leading-none tabular-nums ${champ ? '' : band ? band.accent : 'text-ink-300'}`}
                    style={champ ? {
                      // Metal, not paint: flat yellow read as Satisfactory (the user, 12 Nov: "make the shining").
                      backgroundImage: dark
                        ? `linear-gradient(100deg, ${GOLD.base} 0%, ${GOLD.bright} 22%, #fffbe6 34%, ${GOLD.bright} 46%, ${GOLD.base} 62%, ${GOLD.light} 78%, ${GOLD.base} 100%)`
                        : `linear-gradient(100deg, ${GOLD.deep} 0%, ${GOLD.base} 24%, ${GOLD.bright} 36%, ${GOLD.base} 48%, ${GOLD.deep} 64%, ${GOLD.base} 80%, ${GOLD.deep} 100%)`,
                      backgroundSize: '240% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                      filter: dark ? `drop-shadow(0 0 12px ${GOLD.base}55)` : 'none',
                    } : undefined}>
                    <span className={champ ? 'mh-gold' : undefined}>{avg !== null ? avg.toFixed(1) : '—'}</span>
                    <span className="ml-1 text-base font-medium text-ink-400" style={champ ? { WebkitTextFillColor: 'currentColor' } : undefined}>/100</span>
                  </p>
                  {champ && <style>{`.mh-gold{display:inline-block;background:inherit;-webkit-background-clip:text;background-clip:text;animation:mh-shine 5s linear infinite}
                    @keyframes mh-shine{from{background-position:130% 0}to{background-position:-110% 0}}
                    @media (prefers-reduced-motion:reduce){.mh-gold{animation:none}}`}</style>}
                </div>
                <span className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-label ${band ? band.chip : 'bg-ink-100 text-ink-500'}`}>
                  {avg === null ? 'Not scored yet' : rating === null ? band?.label : ratingLabel(rating)}
                  {rating !== null && (
                    <>
                      <span className="h-2.5 w-px bg-current opacity-30" aria-hidden />
                      <span className="font-semibold tabular-nums opacity-90"><span className="sr-only">Rating </span>{rating}<span className="opacity-50">/5</span></span>
                    </>
                  )}
                </span>
              </div>
              {/* The dividing line is the band scale, bright up to the year average, as the Dashboard's (the user, 12 Nov:
                  "the separating line, here make it our band color"). */}
              <div className="relative h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                <div className="absolute inset-0 opacity-25" style={{ backgroundImage: SCALE }} />
                {avg !== null && (
                  <div className="absolute inset-0" style={{ backgroundImage: SCALE, clipPath: `inset(0 ${100 - Math.max(0, Math.min(100, avg))}% 0 0)` }} />
                )}
              </div>
              <div className={`grid gap-3 lg:grid-cols-1 ${parts.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {parts.map(x => (
                  <div key={x.label} className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between">
                    <span className="flex items-center gap-1.5 text-xs text-ink-500">
                      {/* The graph's key, so only where the graph is: not on a phone (the user, 12 Nov). */}
                      {x.colour && <span className="hidden h-[3px] w-2.5 rounded-full sm:inline-block" style={{ background: x.colour }} aria-hidden />}{x.label}
                    </span>
                    <span>
                      <span className={`text-lg font-semibold tabular-nums ${x.value == null ? 'text-ink-300' : 'text-ink-900'}`}>{x.value != null ? ('whole' in x && x.whole ? String(x.value) : x.value.toFixed(1)) : '—'}</span>
                      <span className="text-xs text-ink-400"> /{x.of}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {hasAnyScore && (
        // Not on a phone: the Dashboard's team card shows the same months (the user, 12 Nov: "in mobile we dont need
        // this graph").
        <div className="hidden min-w-0 sm:block sm:p-4">
          <h3 className="mb-2 px-2 text-sm font-semibold text-ink-800 sm:mb-4 sm:px-0">Score trend</h3>
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={TREND_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeef0" />
                <XAxis dataKey="month" tick={tick} interval={0} />
                <YAxis domain={[0, 100]} tick={tick} width={narrow ? 26 : 40} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd' }}
                  formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—')}
                />
                <Legend wrapperStyle={{ fontSize: narrow ? 11 : 12 }} />
                {/* Value labels sit above each point in their own line's
                    colour, so the series can be read without the legend. */}
                {/* Ink, and it follows the theme: the total was the darkest
                    line on the chart and on a dark page that is the page's
                    own colour. Decided here because Recharts writes stroke
                    as an SVG attribute, which does not take var(). */}
                <defs>
                  <linearGradient id="mh-total" x1="0" y1="0" x2="1" y2="0">
                    {seg.flatMap(g => [<stop key={`${g.from}a`} offset={at(g.from)} stopColor={g.c} />, <stop key={`${g.to}b`} offset={at(g.to)} stopColor={g.c} />])}
                  </linearGradient>
                </defs>
                <Line type="monotone" dataKey="Total" stroke={seg.length ? 'url(#mh-total)' : ink} strokeWidth={2.5}
                      dot={TotalDot} activeDot={{ r: 5 }} connectNulls
                      label={<ScoreLabel fill={ink} dy={-12} count={chartData.length} fontSize={lf} />} />
                <Line type="monotone" dataKey="Job role" stroke={JOB} strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls
                      label={<ScoreLabel fill={JOB} dy={-10} count={chartData.length} fontSize={lf} />} />
                {/* Only for the people who carry it — nobody else needs a
                    fourth legend entry for a band they do not have.
                    Violet: it is the colour of the band on the sheet, and
                    it separates from the red and the grey by hue rather
                    than by lightness, which survives colour blindness. */}
                {hasEsms && (
                  <Line type="monotone" dataKey="ESMS" stroke="#7c3aed" strokeWidth={1.5}
                        dot={{ r: 2 }} connectNulls
                        label={<ScoreLabel fill="#7c3aed" dy={-10} count={chartData.length} fontSize={lf} />} />
                )}
                <Line type="monotone" dataKey="Core values" stroke={CORE} strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls
                      label={<ScoreLabel fill={CORE} dy={14} count={chartData.length} fontSize={lf} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
            )}
          </div>
        )
      })()}

      {(() => {
      /*
        Which columns this table earns.

        It had five and used three. "Self" was empty on every row, because
        a self-assessment covers the job role only and most people never
        file one; "Manager" and "Final" held the same number on every
        settled month, because the final IS the manager's score unless
        somebody changed it. Three columns of dashes and duplicates is
        three things to read before finding the one that moved.

        So: Self appears when a self-assessment exists to show, and Manager
        and Final collapse into one "Score" until a month is actually
        adjusted — at which point both come back, for every row, so the
        one that changed can be compared against the ones that did not.
      */
      const months = fyMonthsFrom(fy, startsFrom)
      const cells = months.map(m => byMonth.get(m))
      const anySelf = cells.some(c => c?.self_job_role_score != null)
      const adjusted = (c: typeof cells[number]) =>
        c?.final_total_score != null && c?.mgr_total_score != null
        && Math.abs(c.final_total_score - c.mgr_total_score) > 0.005
      const anyAdjusted = cells.some(adjusted)

      return (
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">Month by month</h3>
        </div>
        {/* Phones: one row a month, the score at the end and an arrow, no table to scroll sideways for View
            (the user, 12 Nov: "im seeing people scrolling to find view"). */}
        {/* Each month its own box, as the KRAs and My Team (the user, 12 Nov: "and that seperation"). */}
        <ul className="space-y-2 p-3 sm:hidden">
          {months.map(m => {
            const s = byMonth.get(m)
            const open = isMonthOpen(m)
            const fin = s?.final_total_score != null
            const total = fin ? s?.final_total_score : s?.mgr_total_score
            const parts: Array<[string, number | null | undefined]> = [
              ['Job', fin ? s?.final_job_role_score : s?.mgr_job_role_score],
              ...(hasEsms ? [['ESMS', fin ? s?.final_esms_score : s?.mgr_esms_score] as [string, number | null | undefined]] : []),
              ['Core', fin ? s?.final_core_score : s?.mgr_core_score],
            ]
            return (
              <li key={m}>
                <button type="button" disabled={!open || (manager && !s)}
                  onClick={() => go(m)}
                  className={`group relative isolate flex w-full items-center gap-3 overflow-hidden rounded-xl border border-ink-200 px-3 py-2.5 text-left transition-colors ${open ? 'bg-ink-50/60 hover:bg-ink-100 active:bg-ink-100' : 'bg-ink-50/30'}`}>
                  {/* A light wash of the month's score colour that deepens under the pointer, as My Team (the user, 12 Nov). */}
                  {open && total != null && (
                    <span aria-hidden
                      className={`pointer-events-none absolute inset-0 -z-10 bg-gradient-to-l ${bandFor(Number(total))?.wash ?? ''} to-transparent opacity-[var(--w)] transition-opacity duration-200 group-hover:opacity-100`}
                      style={{ '--w': dark ? 0.35 : 0.8 } as React.CSSProperties} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block font-semibold ${open ? 'text-ink-900' : 'text-ink-400'}`}>{monthLabel(m)}</span>
                    <span className="mt-1 block">
                      {open ? (
                        <StatusBadge status={s?.status ?? null} queried={!!s && !!queried?.has(s.id)} outcome={s?.deadline_outcome} />
                      ) : (
                        <span className="badge inline-flex items-center gap-1 bg-ink-100 text-ink-400"><Lock className="h-3 w-3" /> Not yet open</span>
                      )}
                    </span>
                  </span>
                  {open && (
                    <span className="shrink-0 text-right">
                      {total != null ? <ScorePill value={total} size="sm" /> : <span className="text-sm text-ink-300">—</span>}
                      {total != null && (
                        <span className="mt-1 block text-[11px] leading-tight text-ink-400">
                          {parts.map(([l, v], i) => (
                            <span key={l}>{i > 0 && ' · '}{l} <span className="font-semibold tabular-nums text-ink-600">{v == null ? '—' : v.toFixed(2)}</span></span>
                          ))}
                        </span>
                      )}
                      {s?.self_job_role_score != null && (
                        <span className="mt-0.5 block text-[11px] leading-tight text-ink-400">
                          {selfRatesCore && s.self_core_score != null ? 'Self' : 'Self job'} <span className="font-semibold tabular-nums text-ink-600">{(selfRatesCore && s.self_core_score != null
                            ? s.self_total_score ?? s.self_job_role_score + (s.self_esms_score ?? 0) + s.self_core_score
                            : s.self_job_role_score).toFixed(2)}</span>
                        </span>
                      )}
                    </span>
                  )}
                  {open && <ChevronRight className="h-5 w-5 shrink-0 text-ink-300" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
        {/* Computers: each part its own column, the move from last month and the team rank, so the middle is not empty
            (the user, 12 Nov: "is there any better suggestion to use this spaces?" — "only for desktop"). */}
        <div className="hidden overflow-x-auto sm:block">
          {(() => {
            const counted = (c: typeof cells[number]) => {
              const fin = c?.final_total_score != null
              return {
                total: fin ? c?.final_total_score : c?.mgr_total_score,
                job: fin ? c?.final_job_role_score : c?.mgr_job_role_score,
                esms: fin ? c?.final_esms_score : c?.mgr_esms_score,
                core: fin ? c?.final_core_score : c?.mgr_core_score,
              }
            }
            const rankOf = new Map((manager ? [] : team.data ?? []).filter(r => r.is_me && (r.team_of ?? 0) > 1)
              .map(r => [r.period_month?.slice(0, 10), r.team_rank] as const))
            const anyRank = months.some(m => rankOf.has(m))
            // A KPI where the person rates core values too (Ajith sir's team, 28 Oct): Self is their whole self score,
            // job and core under it; otherwise it is the job role alone and the header says so (the user, 12 Nov: "self
            // score isnt? so what if under ajith a user puts core vlaue?").
            // Read off the KPI, not the months: older months hold a self core figure nobody entered (E1427, 12 Nov: "why
            // core vlaue for me?").
            const selfCore = assignment?.assignment?.core_self_rating === true
            const f2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))
            const th = 'px-4 py-2.5 text-right'
            // Whose figure it is, under the heading (the user, 12 Nov: "next 2 columns just show it is by manager").
            // Self a light grey, by manager a darker one: told apart in the standard greys (the user, 12 Nov).
            const sub = (t: string) => <span className={`block text-[10px] font-semibold normal-case tracking-normal ${
              t === 'self' ? 'text-ink-400' : 'text-ink-600'}`}>{t}</span>
            return (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5">Month</th>
                <th className="px-4 py-2.5">Status</th>
                {/* What on top, whose under it, the same for self and manager, so the two read as two sides (the user,
                    12 Nov: "no job role top like that, user should feel self and manager diff"); core values a column of
                    its own when the person rates them. */}
                {anySelf && <th className={th}>Job role{sub('self')}</th>}
                {anySelf && selfCore && hasEsms && <th className={th}>ESMS{sub('self')}</th>}
                {anySelf && selfCore && <th className={th}>Core values{sub('self')}</th>}
                <th className={th}>Job role{sub('by manager')}</th>
                {hasEsms && <th className={th}>ESMS{sub('by manager')}</th>}
                <th className={th}>Core values{sub('by manager')}</th>
                {anyAdjusted && <th className={th}>Manager</th>}
                <th className={th}>{anyAdjusted ? 'Final' : 'Total'}</th>
                <th className={th}>vs last month</th>
                {anyRank && <th className="px-4 py-2.5 text-center">Team rank</th>}
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {months.map((m, i) => {
                const s = byMonth.get(m)
                const open = isMonthOpen(m)
                const c = open ? counted(s) : null
                const prev = i > 0 && isMonthOpen(months[i - 1]) ? counted(byMonth.get(months[i - 1])).total : null
                const d = c?.total != null && prev != null ? c.total - prev : null
                const rank = open ? rankOf.get(m) : undefined
                return (
                  <tr key={m}
                    onClick={open && (!manager || s) ? () => go(m) : undefined}
                    className={open ? 'cursor-pointer hover:bg-ink-50' : 'bg-ink-50/40 text-ink-300'}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <span className={open ? 'text-ink-900' : 'text-ink-400'}>{monthLabel(m)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {open ? (
                        <StatusBadge status={s?.status ?? null} queried={!!s && !!queried?.has(s.id)} outcome={s?.deadline_outcome} />
                      ) : (
                        <span className="badge inline-flex items-center gap-1 bg-ink-100 text-ink-400"><Lock className="h-3 w-3" /> Not yet open</span>
                      )}
                    </td>
                    {anySelf && <td className="px-4 py-3 text-right tabular-nums text-ink-500">{open ? f2(s?.self_job_role_score) : ''}</td>}
                    {anySelf && selfCore && hasEsms && <td className="px-4 py-3 text-right tabular-nums text-ink-500">{open ? f2(s?.self_esms_score) : ''}</td>}
                    {anySelf && selfCore && <td className="px-4 py-3 text-right tabular-nums text-ink-500">{open ? f2(s?.self_core_score) : ''}</td>}
                    <td className="px-4 py-3 text-right tabular-nums text-ink-800">{c ? f2(c.total != null ? c.job : null) : ''}</td>
                    {hasEsms && <td className="px-4 py-3 text-right tabular-nums text-ink-800">{c ? f2(c.total != null ? c.esms : null) : ''}</td>}
                    <td className="px-4 py-3 text-right tabular-nums text-ink-800">{c ? f2(c.total != null ? c.core : null) : ''}</td>
                    {anyAdjusted && <td className="px-4 py-3 text-right tabular-nums text-ink-500">{open ? f2(s?.mgr_total_score) : ''}</td>}
                    <td className="px-4 py-3 text-right">{c?.total != null ? <ScorePill value={c.total} size="sm" /> : open ? <span className="text-ink-300">—</span> : null}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold tabular-nums">
                      {d == null ? <span className="text-ink-300">{open && c?.total != null ? '—' : ''}</span>
                        : d > 0.5 ? <span className="text-emerald-600">▲ {d.toFixed(2)}</span>
                        : d < -0.5 ? <span className="text-cyrixRed-600">▼ {Math.abs(d).toFixed(2)}</span>
                        : <span className="text-amber-500">● {Math.abs(d).toFixed(2)}</span>}
                    </td>
                    {anyRank && (
                      <td className="px-4 py-3 text-center">
                        {rank == null ? <span className="text-ink-300">{open ? '—' : ''}</span> : (
                          <span aria-label={`Team rank ${rank}`} className={`inline-grid h-6 w-6 place-items-center rounded-full border text-[11px] font-bold tabular-nums ${
                            rank === 1 ? 'border-amber-400 bg-amber-300 text-amber-950'
                            : rank === 2 ? 'border-slate-300 bg-slate-200 text-slate-800'
                            : rank === 3 ? 'border-orange-300 bg-orange-200 text-orange-900'
                            : 'border-ink-200 bg-ink-50 text-ink-700'}`}>
                            {rank === 1 ? <Crown className="h-3.5 w-3.5" strokeWidth={2.5} /> : rank}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-2 py-3 text-right">{open && <ChevronRight className="ml-auto h-4 w-4 text-ink-300" aria-hidden />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
            )
          })()}
        </div>
      </div>
      )
      })()}
    </div>
  )
}
