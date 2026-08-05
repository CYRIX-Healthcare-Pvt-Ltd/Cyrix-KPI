import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts'
import { monthLabel } from '@/lib/fy'
import { bandFor, BAND_SCALE } from '@/lib/bands'

export interface TrendPoint {
  /** Month start, '2026-07-01'. */
  month: string
  score: number | null
}

/**
 * A value printed above its own point, kept inside the plot.
 *
 * Two ways a data label escapes its container, and both were happening:
 * vertically, where a label sits above the highest point and the chart's
 * top margin has no room for it; and horizontally, where the first and
 * last labels are centred on points that sit on the plot's own edges, so
 * half the text lands on the axis or past the right border.
 *
 * The ends anchor inwards. The top margin is the caller's job — see
 * TREND_MARGIN, which every chart using this label shares so none of
 * them can drift back to clipping.
 */
export function ScoreLabel({
  x, y, value, fill = '#141519', dy = -12, index, count,
}: {
  x?: number
  y?: number
  value?: number | string | null
  fill?: string
  dy?: number
  /** Injected by recharts when it clones this element per point. */
  index?: number
  count?: number
}) {
  if (value === null || value === undefined || x === undefined || y === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return null

  const isLast = count !== undefined && index === count - 1
  const isFirst = index === 0

  return (
    <text
      x={x + (isLast ? 4 : isFirst ? -4 : 0)}
      y={y + dy}
      fill={fill}
      fontSize={11}
      fontWeight={600}
      textAnchor={isLast ? 'end' : isFirst ? 'start' : 'middle'}
    >
      {n.toFixed(1)}
    </text>
  )
}

/**
 * Room for a label above the tallest point and either side of the ends.
 *
 * Shared rather than typed per chart, because "the label is cut off" is
 * the bug that comes back every time somebody adds a chart and picks a
 * top margin by eye.
 */
export const TREND_MARGIN = { top: 26, right: 18, left: 0, bottom: 0 }

/**
 * One score, over the months of a year.
 *
 * Deliberately one series and no legend — the heading names it, and a
 * legend box for a single line is a label saying "this line is the line".
 * Identity is carried by the band the line is sitting in rather than by
 * the line's own colour: the score bands are shaded behind it, which
 * makes 84 legible as Very Good without a second axis, a second series,
 * or the reader remembering where 80 is.
 *
 * The line itself stays ink, not band colour. A line that repaints as the
 * average crosses 80 would be a chart whose colour means two things at
 * once, and the shading already says which band each point is in.
 */
export default function ScoreTrend({
  points,
  height = 200,
  emptyMessage = 'No scored months yet.',
}: {
  points: TrendPoint[]
  height?: number
  emptyMessage?: string
}) {
  const data = points.map(p => ({
    month: monthLabel(p.month).split('-')[0],
    full: monthLabel(p.month),
    score: p.score,
  }))

  if (!data.some(d => d.score !== null)) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-ink-50 text-sm text-ink-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={TREND_MARGIN}>
          {/* The scale, behind the data. Same bands as the score meter and
              the same source, so the two cannot drift apart. */}
          {BAND_SCALE.map(({ band, from, to }) => (
            <ReferenceArea
              key={band.key}
              y1={from} y2={to}
              fill={band.hex.base}
              fillOpacity={0.07}
              strokeOpacity={0}
            />
          ))}
          <CartesianGrid vertical={false} stroke="#eeeef0" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#6b6e79' }}
            axisLine={{ stroke: '#d8d9dd' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 40, 60, 80, 100]}
            tick={{ fontSize: 11, fill: '#6b6e79' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: '#b9bbc3', strokeDasharray: '3 3' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd' }}
            labelFormatter={(_, payload) =>
              (payload?.[0]?.payload as { full?: string })?.full ?? ''}
            formatter={(v: unknown) => {
              if (typeof v !== 'number') return ['—', 'Score']
              return [`${v.toFixed(1)} · ${bandFor(v)?.label ?? ''}`, 'Score']
            }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#141519"
            strokeWidth={2}
            dot={{ r: 3, fill: '#141519', strokeWidth: 0 }}
            // Bigger than the mark, so a thumb can find a point that is
            // only 6px across.
            activeDot={{ r: 6, fill: '#141519', stroke: '#fff', strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
            label={<ScoreLabel count={data.length} />}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
