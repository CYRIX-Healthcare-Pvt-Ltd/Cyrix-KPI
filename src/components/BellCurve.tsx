import { useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Scatter, XAxis, YAxis,
  Tooltip, ReferenceArea, ReferenceLine, Cell,
} from 'recharts'
import { bandFor, attainmentPct, BAND_SCALE } from '@/lib/bands'

/** A smooth curve needs a shape to be smooth about. */
const MIN_PEOPLE = 3

/**
 * The normal kernel. Nothing exotic: this is what makes the curve a
 * curve rather than a staircase of counts.
 */
const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)

/** Round numbers a person would choose for an axis. */
const STEPS = [0.5, 1, 2, 5, 10, 20, 25]
const niceStep = (raw: number) => STEPS.find(s => s >= raw) ?? 25

/**
 * How wide each person's contribution is spread.
 *
 * Silverman's rule scaled to the sample, with a floor: without one, a
 * tight team produces a spike two points wide, which is arithmetically
 * honest and reads as a broken chart.
 *
 * The floor is a share of the band rather than a fixed number of points,
 * because this chart now plots core values out of 20 as readily as a
 * total out of 100, and five points of smoothing on a twenty point band
 * is most of the band.
 */
function bandwidth(values: number[], outOf: number): number {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  return Math.max(outOf * 0.035, 1.06 * sd * Math.pow(n, -1 / 5))
}

/**
 * Where a team sits across a band's range.
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
 * and the shape can be read without checking the axis. The stops are
 * mapped through the visible window rather than assumed to be at 0–100,
 * or an axis running 20 to 80 would paint Good where Satisfactory is.
 */
export default function BellCurve({
  values,
  outOf,
  floor,
  height = 220,
  emptyMessage = 'Not enough scored people yet.',
}: {
  /** One figure per person, in the band's own points. */
  values: number[]
  /** What that band is marked out of — 100, 80, 20, 5. */
  outOf: number
  /**
   * Where the axis starts when the data allows. Most of a scored team
   * sits in the top half of its band, so starting at zero spends half
   * the width drawing an empty floor. It drops below this on its own if
   * somebody is down there.
   */
  floor: number
  height?: number
  emptyMessage?: string
}) {
  const model = useMemo(() => {
    const clean = values.filter(v => Number.isFinite(v))
    if (clean.length < MIN_PEOPLE) return null

    const step = niceStep(outOf / 10)
    const min = Math.min(...clean)

    // Only ever widens, never narrows: somebody at 27 out of 100 pulls
    // the axis down to 20 rather than being drawn on the edge of it.
    const lo = min < floor
      ? Math.max(0, Math.floor((min - step / 2) / step) * step)
      : floor
    const hi = outOf
    const span = hi - lo

    const h = bandwidth(clean, outOf)
    const n = clean.length
    const mean = clean.reduce((a, b) => a + b, 0) / n

    const curve = Array.from({ length: 101 }, (_, i) => {
      const x = lo + (span * i) / 100
      return {
        x,
        density: clean.reduce((sum, v) => sum + phi((x - v) / h), 0) / (n * h),
      }
    })

    const perBand = BAND_SCALE.map(({ band, from, to }) => ({
      band,
      // Boundaries are percentages of the band; the readings are points.
      lo: (from / 100) * outOf,
      hi: (to / 100) * outOf,
      count: clean.filter(v => {
        const pct = attainmentPct(v, outOf) ?? 0
        return pct >= from && (to === 100 ? pct <= to : pct < to)
      }).length,
    }))

    const ticks: number[] = []
    for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100)

    return {
      curve, mean, lo, hi, ticks, perBand,
      people: n,
      dots: clean.map(v => ({ x: v, y: 0 })),
    }
  }, [values, outOf, floor])

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
  const span = model.hi - model.lo
  /** A band boundary's position across the visible window, 0–1. */
  const at = (raw: number) => Math.min(1, Math.max(0, (raw - model.lo) / span))
  const fmt = (v: number) =>
    outOf === 100 ? `${v}%` : `${Math.round(v * 10) / 10}`

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={model.curve}
          // Left and right room for the end ticks. At left: 0 the first
          // label is centred on the axis origin and half of it lands
          // outside the plot, so recharts drops it — the axis opened at
          // 40 and the lowest number on it read 50.
          margin={{ top: 16, right: 16, left: 14, bottom: 0 }}
        >
          <defs>
            {/* Hard stops at the thresholds, from the same BAND_SCALE the
                meter and the trend chart draw, positioned through the
                window actually on screen. The gradient maps to the path's
                own box, and the curve spans the whole window, so the box
                is the window. */}
            <linearGradient id="bellStroke" x1="0" y1="0" x2="1" y2="0">
              {model.perBand.flatMap(({ band, lo, hi }) => [
                <stop key={`${band.key}-a`} offset={`${at(lo) * 100}%`}
                      stopColor={band.hex.base} />,
                <stop key={`${band.key}-b`} offset={`${at(hi) * 100}%`}
                      stopColor={band.hex.base} />,
              ])}
            </linearGradient>
            <linearGradient id="bellFill" x1="0" y1="0" x2="1" y2="0">
              {model.perBand.flatMap(({ band, lo, hi }) => [
                <stop key={`${band.key}-a`} offset={`${at(lo) * 100}%`}
                      stopColor={band.hex.base} stopOpacity={0.18} />,
                <stop key={`${band.key}-b`} offset={`${at(hi) * 100}%`}
                      stopColor={band.hex.base} stopOpacity={0.18} />,
              ])}
            </linearGradient>
          </defs>

          {/* The bands behind everything, at a whisper. Clipped to the
              window, so a band left off the axis is not drawn at all. */}
          {model.perBand
            .filter(b => b.hi > model.lo)
            .map(({ band, lo, hi }) => (
              <ReferenceArea
                key={band.key}
                x1={Math.max(lo, model.lo)} x2={hi}
                fill={band.hex.base}
                fillOpacity={0.05}
                strokeOpacity={0}
              />
            ))}

          <XAxis
            dataKey="x"
            type="number"
            domain={[model.lo, model.hi]}
            ticks={model.ticks}
            tickFormatter={fmt}
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
            content={({ active, label }) => {
              if (!active || typeof label !== 'number') return null
              const band = bandFor(attainmentPct(label, outOf))
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
              value: `avg ${fmt(Math.round(model.mean * 10) / 10)}`,
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
              <Cell key={i} fill={bandFor(attainmentPct(d.x, outOf))?.hex.base ?? '#8a8d97'} />
            ))}
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
