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
        <LineChart data={data} margin={{ top: 10, right: 12, left: -22, bottom: 0 }}>
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
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
