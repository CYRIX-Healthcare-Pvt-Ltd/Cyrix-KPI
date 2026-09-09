import { Link, useLocation } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useSubmissionHistory, useAnnualSummary, useMyAssignment,
  useSettleDueMonths, useOpenQueryMonths, currentFy,
} from '@/lib/queries'
import {
  fyMonthsFrom, openFyMonthsFrom, monthLabel, isMonthOpen,
} from '@/lib/fy'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import { useIsDark } from '@/lib/isDark'
import {
  Alert, PageLoader, StatTile, StatusBadge, BandCell,
} from '@/components/ui'
import { ScoreHeader } from '@/components/analysis'
import { ScoreLabel, TREND_MARGIN } from '@/components/ScoreTrend'

export default function MyHistory() {
  const { employee } = useAuth()
  const fy = currentFy()
  const ink = useIsDark() ? '#f4f5f7' : '#141519'
  // Carried here by the submission screen so the confirmation lands
  // beside the row that has just changed rather than on a page the
  // person is about to leave.
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const { data: history, isLoading } = useSubmissionHistory(employee?.id, fy)
  useSettleDueMonths(true)
  const { data: queried } = useOpenQueryMonths(true)
  const { data: annual } = useAnnualSummary(employee?.id, fy)
  // Which bands to print. Read off the assignment rather than off the
  // scores, so somebody who carries ESMS but has not been scored on it
  // yet still sees three figures with a dash in the middle, rather than
  // the split silently changing shape the month their first score lands.
  // Already in the query cache from the dashboard.
  const { data: assignment } = useMyAssignment(employee?.id, fy)
  const esmsWeight = Number(assignment?.assignment?.esms_weight ?? 0)
  const hasEsms = esmsWeight > 0
  const coreWeight = Number(
    assignment?.assignment?.core_values_weight ?? (REMAINDER_TOTAL - esmsWeight),
  )

  if (isLoading) return <PageLoader />

  const byMonth = new Map((history ?? []).map(s => [s.period_month, s]))

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

      <ScoreHeader
        title="My history"
        subtitle={`FY ${fy} · April to March`}
        score={annual?.avg_total_score}
        scoreLabel="Year average"
      />

      <div className="grid grid-cols-2 gap-3 grid-pairs sm:grid-cols-4">
        <StatTile label="Months scored" value={annual?.months_scored ?? 0} sub="of 12" />
        <StatTile label="Best month" value={annual?.highest_month?.toFixed(1) ?? '—'} />
        <StatTile label="Lowest month" value={annual?.lowest_month?.toFixed(1) ?? '—'} />
        <StatTile
          label={hasEsms ? 'Job role / ESMS / core' : 'Job role / core values'}
          value={
            <span className="text-base">
              {annual?.avg_job_role_score?.toFixed(1) ?? '—'}
              {hasEsms && (
                <>
                  <span className="text-ink-400"> / </span>
                  {annual?.avg_esms_score?.toFixed(1) ?? '—'}
                </>
              )}
              <span className="text-ink-400"> / </span>
              {annual?.avg_core_values_score?.toFixed(1) ?? '—'}
            </span>
          }
          sub={hasEsms
            ? `out of ${JOB_ROLE_TOTAL}, ${esmsWeight} and ${coreWeight}`
            : `out of ${JOB_ROLE_TOTAL} and ${coreWeight}`}
        />
      </div>

      {hasAnyScore && (
        <div className="card p-4">
          <h3 className="mb-4 text-sm font-semibold text-ink-800">Score trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={TREND_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeef0" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b6e79' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#6b6e79' }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd' }}
                  formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—')}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {/* Value labels sit above each point in their own line's
                    colour, so the series can be read without the legend. */}
                {/* Ink, and it follows the theme: the total was the darkest
                    line on the chart and on a dark page that is the page's
                    own colour. Decided here because Recharts writes stroke
                    as an SVG attribute, which does not take var(). */}
                <Line type="monotone" dataKey="Total" stroke={ink} strokeWidth={2.5}
                      dot={{ r: 3 }} connectNulls
                      label={<ScoreLabel fill={ink} dy={-12} count={chartData.length} />} />
                <Line type="monotone" dataKey="Job role" stroke="#e30613" strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls
                      label={<ScoreLabel fill="#e30613" dy={-10} count={chartData.length} />} />
                {/* Only for the people who carry it — nobody else needs a
                    fourth legend entry for a band they do not have.
                    Violet: it is the colour of the band on the sheet, and
                    it separates from the red and the grey by hue rather
                    than by lightness, which survives colour blindness. */}
                {hasEsms && (
                  <Line type="monotone" dataKey="ESMS" stroke="#7c3aed" strokeWidth={1.5}
                        dot={{ r: 2 }} connectNulls
                        label={<ScoreLabel fill="#7c3aed" dy={-10} count={chartData.length} />} />
                )}
                <Line type="monotone" dataKey="Core values" stroke="#8a8d97" strokeWidth={1.5}
                      dot={{ r: 2 }} connectNulls
                      label={<ScoreLabel fill="#6b6e79" dy={14} count={chartData.length} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

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
          {/* Said once, here, rather than left for somebody to work out
              from a column of dashes. */}
          {!anyAdjusted && (
            <span className="text-xs text-ink-500">
              Final is the manager&rsquo;s score — no month has been adjusted.
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5">Month</th>
                <th className="px-4 py-2.5">Status</th>
                {anySelf && (
                  <th className="px-4 py-2.5 text-right">
                    Self
                    {/* Named, because it is not comparable with the two
                        beside it: the person scores their job role and
                        nothing else. */}
                    <span className="block text-[10px] font-medium normal-case tracking-normal text-ink-400">
                      job role only
                    </span>
                  </th>
                )}
                <th className="px-4 py-2.5 text-right">
                  {anyAdjusted ? 'Manager' : 'Score'}
                </th>
                {anyAdjusted && <th className="px-4 py-2.5 text-right">Final</th>}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {fyMonthsFrom(fy, startsFrom).map(m => {
                const s = byMonth.get(m)
                // A month that has not finished cannot be assessed yet.
                const open = isMonthOpen(m)

                return (
                  <tr
                    key={m}
                    className={open ? 'hover:bg-ink-50' : 'bg-ink-50/40 text-ink-300'}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      <span className={open ? 'text-ink-900' : 'text-ink-400'}>
                        {monthLabel(m)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {open ? (
                        <StatusBadge
                          status={s?.status ?? null}
                          queried={!!s && !!queried?.has(s.id)}
                        />
                      ) : (
                        <span className="badge inline-flex items-center gap-1 bg-ink-100 text-ink-400">
                          <Lock className="h-3 w-3" /> Not yet open
                        </span>
                      )}
                    </td>
                    {/* A month that is not open cannot legitimately hold a
                        score, so nothing is shown even if stale draft rows
                        exist from before the gate was added. */}
                    {/* The same split the manager sees on their side.
                        Somebody reading their own record should not have
                        to take "88" on trust while the person scoring
                        them can see what it is made of. */}
                    {/* No self TOTAL and no self CORE any more: the person
                        fills in only the job role, so a total would be the job
                        role with core counted as nought, and a core figure
                        would be a zero nobody entered. What they did submit
                        still shows. */}
                    {anySelf && (
                      /*
                        The job-role figure IS the self-assessment, so it is
                        shown as the number rather than as a part of one.

                        It went through BandCell as a part with a null
                        total, and BandCell draws its parts only when there
                        is a total to break down — so every self score that
                        existed was passed in and then not drawn. The column
                        read as an empty column for months that had one.

                        There is no total to break down here and there never
                        will be: the person scores their job role and not the
                        core values, so a "total" would be the job role with
                        core counted as nought.
                      */
                      <td className="px-4 py-3 text-right">
                        <span className="tabular-nums text-ink-600">
                          {s?.self_job_role_score != null
                            ? s.self_job_role_score.toFixed(2)
                            : '—'}
                        </span>
                        {hasEsms && s?.self_esms_score != null && (
                          <p className="mt-1 text-[10px] leading-tight text-ink-400">
                            ESMS{' '}
                            <span className="font-semibold tabular-nums text-ink-600">
                              {s.self_esms_score.toFixed(1)}
                            </span>
                          </p>
                        )}
                      </td>
                    )}
                    <BandCell
                      total={open ? s?.mgr_total_score : null}
                      job={s?.mgr_job_role_score}
                      esms={s?.mgr_esms_score}
                      core={s?.mgr_core_score}
                      hasEsms={hasEsms}
                      /* The pill marks the score that counts. That is the
                         manager's, right up until a final overrides it. */
                      pill={!anyAdjusted}
                    />
                    {anyAdjusted && (
                      <BandCell
                        total={open ? s?.final_total_score : null}
                        job={s?.final_job_role_score}
                        esms={s?.final_esms_score}
                        core={s?.final_core_score}
                        hasEsms={hasEsms}
                        pill
                      />
                    )}
                    <td className="px-4 py-3 text-right">
                      {open ? (
                        <Link
                          to={`/submission/${m}`}
                          className="link-accent text-xs font-semibold hover:underline"
                        >
                          {s ? 'View' : 'Start'}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      )
      })()}
    </div>
  )
}
