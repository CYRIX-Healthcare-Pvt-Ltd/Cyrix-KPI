import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { monthLabel } from '@/lib/fy'
import { useIsDark } from '@/lib/isDark'
import { ScoreLabel } from './ScoreTrend'

export interface BandTrendPoint {
  /** Month start, '2026-07-01'. */
  month: string
  total: number | null
  job: number | null
  esms: number | null
  core: number | null
}

/**
 * Room for a label above the highest point and below the lowest.
 *
 * Larger top than TREND_MARGIN because this chart labels three series
 * rather than one, and the topmost is the total — the line closest to
 * the ceiling.
 */
const MARGIN = { top: 28, right: 20, left: 0, bottom: 8 }

/**
 * The four lines.
 *
 * Total is the only one that moves with the theme, and it has to: it was
 * the ink black of the wordmark, which on a dark page is a line drawn in
 * the page's own colour — the strongest series on the chart, invisible.
 * It becomes near-white, which is the same decision the ink ramp makes.
 *
 * The other three are chosen to read on either ground and do not move.
 * Red is the job role and is the brand red; violet is ESMS; the grey for
 * core values sits at the midpoint on purpose, far enough from both the
 * white page and the near-black one.
 *
 * Not a CSS variable, because Recharts writes `stroke` as an SVG
 * presentation attribute and those do not accept var(). This is one of
 * the few places a colour has to be decided in JavaScript.
 */
const seriesFor = (dark: boolean) => ({
  total: { name: 'Total', colour: dark ? '#f4f5f7' : '#141519', width: 2.5 },
  job:   { name: 'Job role', colour: '#e30613', width: 1.5 },
  esms:  { name: 'ESMS', colour: '#7c3aed', width: 1.5 },
  core:  { name: 'Core values', colour: '#8a8d97', width: 1.5 },
}) as const

/**
 * A score month by month, and what it was made of.
 *
 * Raw points rather than percentages, which is what separates the lines:
 * job role is marked out of 80 and core values out of 20, so they sit at
 * roughly 62 and 15 with the total at 77 and every label has room. Plot
 * them as percentages and all three land in the seventies on top of each
 * other, which is the same information drawn illegibly.
 *
 * A total alone cannot show a strong job role being carried by core
 * values, or the reverse — and that is the thing anybody is looking at
 * this chart to find out.
 *
 * ESMS is drawn but not labelled. It is marked out of 5, so its label
 * would sit on the axis whatever the value; the legend and the tooltip
 * carry it.
 */
export default function BandTrend({
  points,
  hasEsms,
  height = 240,
  emptyMessage = 'No scored months yet.',
}: {
  points: BandTrendPoint[]
  hasEsms: boolean
  height?: number
  emptyMessage?: string
}) {
  const SERIES = seriesFor(useIsDark())

  const data = points.map(p => ({
    month: monthLabel(p.month).split('-')[0],
    full: monthLabel(p.month),
    total: p.total,
    job: p.job,
    esms: p.esms,
    core: p.core,
  }))

  if (!data.some(d => d.total !== null)) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-ink-50 px-4 text-center text-sm text-ink-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke="#eeeef0" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#6b6e79' }}
            axisLine={{ stroke: '#d8d9dd' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
            tick={{ fontSize: 11, fill: '#6b6e79' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: '#b9bbc3', strokeDasharray: '3 3' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd' }}
            labelFormatter={(_, payload) =>
              (payload?.[0]?.payload as { full?: string })?.full ?? ''}
            formatter={(v: unknown, key: unknown) => [
              typeof v === 'number' ? v.toFixed(2) : '—',
              SERIES[key as keyof typeof SERIES]?.name ?? String(key),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={key => SERIES[key as keyof typeof SERIES]?.name ?? String(key)}
          />

          {/* Total's label goes above its point and job role's below, so
              the two closest lines push their numbers apart rather than
              stacking them. Core values sits far enough down that above
              is safe and reads better. */}
          <Line
            type="monotone" dataKey="total"
            stroke={SERIES.total.colour} strokeWidth={SERIES.total.width}
            dot={{ r: 3, fill: SERIES.total.colour, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: SERIES.total.colour, stroke: '#fff', strokeWidth: 2 }}
            connectNulls isAnimationActive={false}
            label={<ScoreLabel count={data.length} fill={SERIES.total.colour} dy={-12} />}
          />
          <Line
            type="monotone" dataKey="job"
            stroke={SERIES.job.colour} strokeWidth={SERIES.job.width}
            dot={{ r: 2.5, fill: SERIES.job.colour, strokeWidth: 0 }}
            connectNulls isAnimationActive={false}
            label={<ScoreLabel count={data.length} fill={SERIES.job.colour} dy={16} />}
          />
          {hasEsms && (
            <Line
              type="monotone" dataKey="esms"
              stroke={SERIES.esms.colour} strokeWidth={SERIES.esms.width}
              dot={{ r: 2.5, fill: SERIES.esms.colour, strokeWidth: 0 }}
              connectNulls isAnimationActive={false}
            />
          )}
          <Line
            type="monotone" dataKey="core"
            stroke={SERIES.core.colour} strokeWidth={SERIES.core.width}
            dot={{ r: 2.5, fill: SERIES.core.colour, strokeWidth: 0 }}
            connectNulls isAnimationActive={false}
            label={<ScoreLabel count={data.length} fill={SERIES.core.colour} dy={-10} />}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
