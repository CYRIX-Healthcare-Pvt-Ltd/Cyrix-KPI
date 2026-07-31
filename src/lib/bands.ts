/**
 * Score bands — the shared language for "how good is this number".
 *
 * Mirrors score_band() in migration 0011. The thresholds are deliberately
 * the same as the qualitative rating scale people already use, so "weak"
 * means genuinely below Good rather than simply the lowest figure on the
 * page. A KRA at 90% of its weightage is not a problem; one at 55% is.
 */

export type BandKey = 'excellent' | 'veryGood' | 'good' | 'satisfactory' | 'poor'

export interface Band {
  key: BandKey
  label: string
  min: number
  /** Text + background for chips and pills. */
  chip: string
  /** Accent used for the page wash and section rules. */
  accent: string
  /** Very soft page-level tint. */
  wash: string
  bar: string
}

export const BANDS: Band[] = [
  {
    key: 'excellent', label: 'Excellent', min: 90,
    chip: 'bg-emerald-100 text-emerald-800',
    accent: 'text-emerald-700', wash: 'from-emerald-50', bar: 'bg-emerald-500',
  },
  {
    key: 'veryGood', label: 'Very Good', min: 80,
    chip: 'bg-lime-100 text-lime-900',
    accent: 'text-lime-800', wash: 'from-lime-50', bar: 'bg-lime-500',
  },
  {
    key: 'good', label: 'Good', min: 60,
    chip: 'bg-amber-100 text-amber-800',
    accent: 'text-amber-700', wash: 'from-amber-50', bar: 'bg-amber-500',
  },
  {
    key: 'satisfactory', label: 'Satisfactory', min: 40,
    chip: 'bg-orange-100 text-orange-800',
    accent: 'text-orange-700', wash: 'from-orange-50', bar: 'bg-orange-500',
  },
  {
    key: 'poor', label: 'Poor', min: -Infinity,
    chip: 'bg-cyrixRed-100 text-cyrixRed-800',
    accent: 'text-cyrixRed-700', wash: 'from-cyrixRed-50', bar: 'bg-cyrixRed-600',
  },
]

/** Anything below Good is what we call out as needing attention. */
export const WEAK_THRESHOLD = 60

export function bandFor(pct: number | null | undefined): Band | null {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return null
  return BANDS.find(b => pct >= b.min) ?? BANDS[BANDS.length - 1]
}

export const isWeak = (pct: number | null | undefined) =>
  pct !== null && pct !== undefined && pct < WEAK_THRESHOLD

/** A KRA's attainment as a percentage of its own weightage. */
export const attainmentPct = (score: number | null, weightage: number) =>
  weightage > 0 && score !== null ? (score / weightage) * 100 : null

/**
 * Direction of travel across the last few months. Compares the most
 * recent two against the two before, so a single soft month doesn't
 * read as a decline.
 */
export function trendOf(scores: Array<number | null>): {
  direction: 'up' | 'down' | 'flat'
  delta: number
} | null {
  const points = scores.filter((s): s is number => s !== null && s !== undefined)
  if (points.length < 3) return null

  const recent = points.slice(-2)
  const prior = points.slice(-4, -2)
  if (prior.length === 0) return null

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const delta = avg(recent) - avg(prior)

  return {
    direction: delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat',
    delta: Math.round(delta * 10) / 10,
  }
}
