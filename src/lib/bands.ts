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
  /**
   * Literal colours, for the two places a Tailwind class cannot reach:
   * the CSS custom properties driving hover states, and the score hero's
   * gradient wash. Kept beside the classes so a band is defined once.
   */
  hex: { base: string; soft: string; strong: string }
  /** Text + background for chips and pills. */
  chip: string
  /** Accent used for the page wash and section rules. */
  accent: string
  /** Very soft page-level tint. */
  wash: string
  bar: string
  /**
   * Tokens for the dark score hero. Band colour reads far more strongly
   * against black than as a pale wash on white, which is what makes the
   * score legible at a glance rather than merely decorative.
   */
  onDark: {
    text: string
    bar: string
    chip: string
    glow: string
  }
}

export const BANDS: Band[] = [
  {
    key: 'excellent', label: 'Excellent', min: 90,
    hex: { base: '#10b981', soft: '#d1fae5', strong: '#065f46' },
    chip: 'bg-emerald-100 text-emerald-800',
    accent: 'text-emerald-700', wash: 'from-emerald-50', bar: 'bg-emerald-500',
    onDark: {
      text: 'text-emerald-400', bar: 'bg-emerald-400',
      chip: 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30',
      glow: 'bg-emerald-500/20',
    },
  },
  {
    key: 'veryGood', label: 'Very Good', min: 80,
    hex: { base: '#84cc16', soft: '#ecfccb', strong: '#3f6212' },
    chip: 'bg-lime-100 text-lime-900',
    accent: 'text-lime-800', wash: 'from-lime-50', bar: 'bg-lime-500',
    onDark: {
      text: 'text-lime-400', bar: 'bg-lime-400',
      chip: 'bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/30',
      glow: 'bg-lime-500/20',
    },
  },
  {
    key: 'good', label: 'Good', min: 60,
    hex: { base: '#f59e0b', soft: '#fef3c7', strong: '#92400e' },
    chip: 'bg-amber-100 text-amber-800',
    accent: 'text-amber-700', wash: 'from-amber-50', bar: 'bg-amber-500',
    onDark: {
      text: 'text-amber-400', bar: 'bg-amber-400',
      chip: 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30',
      glow: 'bg-amber-500/20',
    },
  },
  {
    key: 'satisfactory', label: 'Satisfactory', min: 40,
    hex: { base: '#f97316', soft: '#ffedd5', strong: '#9a3412' },
    chip: 'bg-orange-100 text-orange-800',
    accent: 'text-orange-700', wash: 'from-orange-50', bar: 'bg-orange-500',
    onDark: {
      text: 'text-orange-400', bar: 'bg-orange-400',
      chip: 'bg-orange-400/15 text-orange-300 ring-1 ring-orange-400/30',
      glow: 'bg-orange-500/20',
    },
  },
  {
    key: 'poor', label: 'Poor', min: -Infinity,
    hex: { base: '#e30613', soft: '#fde3e5', strong: '#9e0812' },
    chip: 'bg-cyrixRed-100 text-cyrixRed-800',
    accent: 'text-cyrixRed-700', wash: 'from-cyrixRed-50', bar: 'bg-cyrixRed-600',
    onDark: {
      text: 'text-cyrixRed-400', bar: 'bg-cyrixRed-600',
      chip: 'bg-cyrixRed-600/20 text-cyrixRed-300 ring-1 ring-cyrixRed-500/40',
      glow: 'bg-cyrixRed-600/25',
    },
  },
]

/** Anything below Good is what we call out as needing attention. */
export const WEAK_THRESHOLD = 60

/**
 * The bands in score order — poor first — with the span each one covers.
 *
 * BANDS is written highest-first because that is the order bandFor()
 * needs to search in. Anything drawing the scale needs the opposite, and
 * needs to know where each band ends, which BANDS only implies.
 */
export const BAND_SCALE = [...BANDS].reverse().map((band, i, all) => ({
  band,
  // Poor's min is -Infinity, which is right for a lookup and useless for
  // a ruler, so the bottom of the scale is 0 and the top is 100.
  from: i === 0 ? 0 : band.min,
  to: i === all.length - 1 ? 100 : all[i + 1].min,
}))

/**
 * The whole 0–100 scale as one gradient, hard-edged at the thresholds.
 *
 * Hard stops rather than a blend: the labels underneath name five
 * segments, and a smear would be showing a continuum under words that
 * promise steps. Built from BANDS so the meter cannot drift from the
 * bands it is claiming to draw.
 */
export const bandScaleGradient = (): string =>
  `linear-gradient(to right, ${
    BAND_SCALE
      .flatMap(s => [`${s.band.hex.base} ${s.from}%`, `${s.band.hex.base} ${s.to}%`])
      .join(', ')
  })`

export function bandFor(pct: number | null | undefined): Band | null {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return null
  return BANDS.find(b => pct >= b.min) ?? BANDS[BANDS.length - 1]
}

export const isWeak = (pct: number | null | undefined) =>
  pct !== null && pct !== undefined && pct < WEAK_THRESHOLD

/** A KRA's attainment as a percentage of its own weightage. */
export const attainmentPct = (score: number | null, weightage: number) =>
  weightage > 0 && score !== null ? (score / weightage) * 100 : null

export interface BandWeights { job: number; esms: number; core: number }

/** One month's scores, in the raw points each band is marked out of. */
export interface BandScores {
  job: number | null
  esms: number | null
  core: number | null
  total: number | null
}

/** The same four, as a share of what each was out of. */
export interface BandShare extends BandScores {
  /** How many people are behind these figures. */
  people: number
  /** Does anybody here carry ESMS at all? */
  anyEsms: boolean
}

const mean = (values: Array<number | null>): number | null => {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null
}

/**
 * A team's average in each band, as a percentage of that band.
 *
 * Percentages rather than points, because the bands are not the same size
 * for everybody: core values is worth 20 to most people and 15 to anyone
 * carrying ESMS, so averaging the raw scores of a mixed team produces a
 * figure that is out of nothing in particular. 14 out of 15 and 16 out of
 * 20 are 93% and 80%, and that comparison is the entire reason a manager
 * looks at this.
 *
 * Averaged per person first and then across people, which is how the
 * team average on the same screen is built — otherwise somebody scored
 * on six months counts twice as much as somebody scored on three.
 */
export function teamBandShare(
  people: Array<{ weights: BandWeights; months: BandScores[] }>,
): BandShare {
  const each = people
    .map(p => ({
      job: mean(p.months.map(m => attainmentPct(m.job, p.weights.job))),
      esms: mean(p.months.map(m => attainmentPct(m.esms, p.weights.esms))),
      core: mean(p.months.map(m => attainmentPct(m.core, p.weights.core))),
      // Out of 100 by construction — the three bands always total it.
      total: mean(p.months.map(m => m.total)),
    }))
    // Somebody with no scored month at all is not a zero, they are
    // absent. Including them would drag the team's figure down for not
    // having been assessed yet.
    .filter(p => p.job !== null || p.esms !== null || p.core !== null || p.total !== null)

  return {
    job: mean(each.map(p => p.job)),
    esms: mean(each.map(p => p.esms)),
    core: mean(each.map(p => p.core)),
    total: mean(each.map(p => p.total)),
    people: each.length,
    anyEsms: people.some(p => p.weights.esms > 0),
  }
}

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
