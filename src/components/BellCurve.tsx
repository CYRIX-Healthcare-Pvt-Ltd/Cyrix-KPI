import { useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Scatter, XAxis, YAxis,
  Tooltip, ReferenceArea, ReferenceLine, Cell,
} from 'recharts'
import { bandFor, BAND_SCALE } from '@/lib/bands'

/** A smooth curve needs a shape to be smooth about. */
const MIN_PEOPLE = 3

/**
 * The normal kernel. Nothing exotic: this is what makes the curve a
 * curve rather than a staircase of counts.
 */
const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)

/**
 * How wide each person's contribution is spread.
 *
 * Silverman's rule scaled to the sample, with a floor. Without the floor
 * a tight team produces a spike two points wide, which is arithmetically
 * honest and reads as a broken chart; with it, sixteen people make a
 * recognisable bell. The floor is in score points, so it means the same
 * thing on every team.
 */
function bandwidth(values: number[]): number {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  return Math.max(5, 1.06 * sd * Math.pow(n, -1 / 5))
}

/**
 * Where a team sits across the score range.
 *
 * The month-by-month line answers "are we improving". This answers the
 * other question a manager has, which the line cannot: is the team
 * bunched or spread, and is the bulk of it in the right place. An
 * average of 77 can be everybody at 77 or half at 60 and half at 94, and
 * those need completely different responses.
 *
 * The curve is a kernel density estimate rather than a normal
 * distribution fitted to the mean — a fitted normal is always bell
 * shaped, including when the team is not, which would make the chart a
 * drawing of an assumption. This one is bell shaped when the team is.
 *
 * Colour runs along the x axis on the band scale, so the part of the
 * curve sitting over Poor is red and the part over Excellent is green,
 * and the shape can be read without checking the axis.
 */
export default function BellCurve({
  values,
  height = 220,
  emptyMessage = 'Not enough scored people yet.',
}: {
  /** One figure per person, 0–100. */
  values: number[]
  height?: number
  emptyMessage?: string
}) {
  const model = useMemo(() => {
    const clean = values.filter(v => Number.isFinite(v))
    if (clean.length < MIN_PEOPLE) return null

    const h = bandwidth(clean)
    const n = clean.length
    const mean = clean.reduce((a, b) => a + b, 0) / n

    // Every whole point of the scale. 101 points is cheap and removes
    // any question of the peak landing between samples.
    const curve = Array.from({ length: 101 }, (_, x) => ({
      x,
      density: clean.reduce((sum, v) => sum + phi((x - v) / h), 0) / (n * h),
    }))

    const perBand = BAND_SCALE.map(({ band, from, to }) => ({
      band,
      // Half-open so somebody on exactly 80 is counted once, in the band
      // that starts at 80 — the same rule bandFor uses.
      count: clean.filter(v => v >= from && (to === 100 ? v <= to : v < to)).length,
    }))

    return {
      curve,
      mean,
      people: n,
      perBand,
      dots: clean.map(v => ({ x: v, y: 0 })),
    }
  }, [values])

  if (!model) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-ink-50 px-4 text-center text-sm text-ink-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    )
  }

  const peak = Math.max(...model.curve.map(p => p.density))

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={model.curve}
          margin={{ top: 16, right: 12, left: 0, bottom: 0 }}
        >
          <defs>
            {/* Hard stops at the thresholds, from the same BAND_SCALE the
                meter and the trend chart draw. The gradient maps to the
                path's own box, and the curve is evaluated from 0 to 100,
                so the box is the full width of the scale and the colours
                land exactly on their band boundaries. */}
            <linearGradient id="bellStroke" x1="0" y1="0" x2="1" y2="0">
              {BAND_SCALE.flatMap(({ band, from, to }) => [
                <stop key={`${band.key}-a`} offset={`${from}%`} stopColor={band.hex.base} />,
                <stop key={`${band.key}-b`} offset={`${to}%`} stopColor={band.hex.base} />,
              ])}
            </linearGradient>
            <linearGradient id="bellFill" x1="0" y1="0" x2="1" y2="0">
              {BAND_SCALE.flatMap(({ band, from, to }) => [
                <stop key={`${band.key}-a`} offset={`${from}%`}
                      stopColor={band.hex.base} stopOpacity={0.18} />,
                <stop key={`${band.key}-b`} offset={`${to}%`}
                      stopColor={band.hex.base} stopOpacity={0.18} />,
              ])}
            </linearGradient>
          </defs>

          {/* The bands behind everything, at a whisper, so the boundaries
              are visible where the curve is flat. */}
          {BAND_SCALE.map(({ band, from, to }) => (
            <ReferenceArea
              key={band.key}
              x1={from} x2={to}
              fill={band.hex.base}
              fillOpacity={0.05}
              strokeOpacity={0}
            />
          ))}

          <XAxis
            dataKey="x"
            type="number"
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
            tickFormatter={v => `${v}%`}
            tick={{ fontSize: 11, fill: '#6b6e79' }}
            axisLine={{ stroke: '#d8d9dd' }}
            tickLine={false}
          />
          {/* Hidden on purpose. The height is a probability density —
              a real number with a real meaning that no manager needs, and
              printing it would invite reading it as a headcount. */}
          <YAxis hide domain={[0, peak * 1.15]} />

          <Tooltip
            cursor={{ stroke: '#b9bbc3', strokeDasharray: '3 3' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #d8d9dd' }}
            content={({ active, label }) => {
              if (!active || typeof label !== 'number') return null
              const band = bandFor(label)
              const row = model.perBand.find(b => b.band.key === band?.key)
              if (!band || !row) return null
              return (
                <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <p className="font-semibold" style={{ color: band.hex.base }}>
                    {band.label}
                  </p>
                  <p className="mt-0.5 text-ink-600">
                    {row.count} of {model.people}{' '}
                    {row.count === 1 ? 'person is' : 'people are'} in this band
                  </p>
                </div>
              )
            }}
          />

          <ReferenceLine
            x={model.mean}
            stroke="#141519"
            strokeDasharray="4 3"
            label={{
              value: `avg ${model.mean.toFixed(1)}%`,
              position: 'top',
              fontSize: 11,
              fill: '#141519',
            }}
          />

          <Area
            type="monotone"
            dataKey="density"
            stroke="url(#bellStroke)"
            strokeWidth={2.5}
            fill="url(#bellFill)"
            isAnimationActive={false}
            activeDot={false}
          />

          {/* The actual people, on the axis under the curve. A density
              curve is an interpretation; these are the readings it was
              built from, and with a small team you can count them. */}
          <Scatter data={model.dots} dataKey="y" isAnimationActive={false}>
            {model.dots.map((d, i) => (
              <Cell key={i} fill={bandFor(d.x)?.hex.base ?? '#8a8d97'} />
            ))}
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
