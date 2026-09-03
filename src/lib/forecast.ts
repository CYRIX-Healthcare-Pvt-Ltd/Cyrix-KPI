/**
 * Where the year is heading, and what would move it.
 *
 * Everything Cyra could say until now was a fact about the past: what
 * August came to, which row is weakest, what the team averaged. All true,
 * and none of it answers the question people actually open the panel
 * with — am I going to be alright, and what should I do about it.
 *
 * The arithmetic here is deliberately simple enough to explain in one
 * sentence, because a projection nobody can check is a projection nobody
 * should act on. There is no model and no fitting: it is the average so
 * far, the recent run, and what the two produce if the rest of the year
 * looks like the recent run. Anything cleverer would be a number with a
 * confident face and no defence.
 */

/** One scored month, as everything else in this app carries it. */
export interface MonthPoint {
  period_month: string
  value: number
}

export interface Forecast {
  /** Months actually scored. */
  scored: number
  /** Months the year still expects. */
  remaining: number
  /** The average across everything scored so far. */
  soFar: number
  /** The recent run — the last three months, or fewer if that is all. */
  recent: number
  /** Where the year lands if the recent run holds. */
  projected: number
  /** Which way the recent run sits against the average so far. */
  direction: 'up' | 'down' | 'flat'
  /**
   * How much weight to put on it.
   *
   * Not a percentage, because there is no honest one. Two months is a
   * guess wearing a decimal point, and saying so plainly is the only
   * thing that makes the number safe to publish.
   */
  confidence: 'low' | 'fair' | 'good'
}

/** Below this, "up" and "down" are noise rather than direction. */
const DRIFT = 2

/**
 * The year's likely finish.
 *
 * Returns null rather than a number when there is nothing to go on: one
 * scored month cannot imply eleven, and a projection built from it would
 * be the same figure repeated with false authority.
 *
 * `remaining` is how many months the person is still expected to submit.
 * Zero means the year is done and the projection is simply the average,
 * which is correct and worth returning — the caller may still want to
 * say where it landed.
 */
export function forecastYear(
  points: MonthPoint[],
  remaining: number,
): Forecast | null {
  const values = points
    .filter(p => Number.isFinite(p.value))
    .sort((a, b) => a.period_month.localeCompare(b.period_month))
    .map(p => p.value)

  if (values.length < 2) return null

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const soFar = mean(values)
  // Three, or whatever there is. Two months of recent history is thin,
  // but it is the half of the data that describes now.
  const recent = mean(values.slice(-Math.min(3, values.length)))

  const left = Math.max(0, Math.round(remaining))
  const projected = left === 0
    ? soFar
    : (soFar * values.length + recent * left) / (values.length + left)

  const delta = recent - soFar
  return {
    scored: values.length,
    remaining: left,
    soFar: round(soFar),
    recent: round(recent),
    projected: round(projected),
    direction: delta > DRIFT ? 'up' : delta < -DRIFT ? 'down' : 'flat',
    confidence: values.length <= 2 ? 'low' : values.length <= 4 ? 'fair' : 'good',
  }
}

const round = (n: number) => Math.round(n * 10) / 10

/** One KRA, as the chat answers already carry them. */
export interface LeverRow {
  kra: string
  weightage: number
  /** What the row is achieving, as a share of its own weightage. */
  attainmentPct: number
}

export interface Lever {
  kra: string
  weightage: number
  attainmentPct: number
  /** Where this row would have to reach for the gain below. */
  target: number
  /**
   * Points on the 100-scale the whole score gains if it does.
   *
   * This is the number that makes the advice worth giving. "Your weakest
   * row is Response time at 55%" is true of a row worth 5% and a row
   * worth 30%, and only one of them is worth a month of anybody's
   * attention.
   */
  gain: number
}

/**
 * The row where effort buys the most.
 *
 * Weakest-by-percentage is the wrong answer and was the one on offer: a
 * 5% row at 40% is more visibly broken than a 30% row at 75%, and fixing
 * it earns a third as much. What matters is weightage times the room
 * above it.
 *
 * `target` is what "fixed" is taken to mean — 90% of the row by default,
 * which is Excellent on the same scale the bands use, and reachable in a
 * way that 100 is not.
 */
export function biggestLever(rows: LeverRow[], target = 90): Lever | null {
  let best: Lever | null = null
  for (const row of rows) {
    const weightage = Number(row.weightage) || 0
    const attainmentPct = Number(row.attainmentPct)
    if (weightage <= 0 || !Number.isFinite(attainmentPct)) continue
    // Already there. Nothing to win, and telling somebody to improve a
    // row they have mastered is how advice stops being read.
    if (attainmentPct >= target) continue

    const gain = round((weightage * (target - attainmentPct)) / 100)
    if (gain <= 0) continue
    if (!best || gain > best.gain) {
      best = { kra: row.kra, weightage, attainmentPct: round(attainmentPct), target, gain }
    }
  }
  return best
}

/**
 * Averages a KRA's months into one figure per row.
 *
 * A row is asked about across the year, not in one month: a single bad
 * September says less than a steady 60% since April, and the advice
 * should follow the pattern rather than the most recent point.
 */
export function averageRows(
  rows: Array<{ kra: string; weightage: number; attainment_pct: number | null }>,
): LeverRow[] {
  const byKra = new Map<string, { weightage: number; values: number[] }>()
  for (const r of rows) {
    if (r.attainment_pct === null || !Number.isFinite(r.attainment_pct)) continue
    const entry = byKra.get(r.kra) ?? { weightage: Number(r.weightage) || 0, values: [] }
    // The weightage is a property of the row, not of the month. Where a
    // KPI was corrected mid-year the later one is the one in force.
    entry.weightage = Number(r.weightage) || entry.weightage
    entry.values.push(Number(r.attainment_pct))
    byKra.set(r.kra, entry)
  }
  return [...byKra].map(([kra, e]) => ({
    kra,
    weightage: e.weightage,
    attainmentPct: e.values.reduce((a, b) => a + b, 0) / e.values.length,
  }))
}
