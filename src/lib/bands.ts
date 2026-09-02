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
  /**
   * The same band, a step quieter: an outline and a wash rather than a
   * fill. For a control that should carry the band colour without
   * outshouting the score sitting beside it — a chip and a button both
   * filled at 100 in one row read as two scores rather than a score and
   * a way in.
   */
  tint: string
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

/*
  Why the colour break sits at 60 and not at 80.

  HR's reading of the scale, and the right one: Good means the person is
  doing the job as their manager expected. Good used to be amber — the
  colour every dashboard on earth uses for "attention required" — so
  somebody meeting expectations was shown the same colour as somebody
  who is not.

  The app already disagreed with itself about this. WEAK_THRESHOLD is 60,
  and everything that flags a problem — "areas below Good", the weak
  areas list, "nobody is averaging below Good" — measures from there. The
  words said four of the five bands were positive; the colours said three
  of the five were warnings.

  So the ramp is red → amber → lime → green → emerald: one alarm, one
  caution, three shades of on-track. Colour changes where meaning
  changes, and only the two bands that are genuinely below expectation
  are coloured like it.

  Every surface reads from here — the meter, the pills, the chips, the
  hero, the trend chart, the bell curve — so this is the only place it
  needs saying. The database stores labels and thresholds only.
*/
export const BANDS: Band[] = [
  {
    key: 'excellent', label: 'Excellent', min: 90,
    hex: { base: '#059669', soft: '#d1fae5', strong: '#064e3b' },
    chip: 'bg-emerald-100 text-emerald-900',
    tint: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
    accent: 'text-emerald-800', wash: 'from-emerald-50', bar: 'bg-emerald-600',
    onDark: {
      // Lighter than the light-mode base: #059669 on black is a smudge.
      text: 'text-emerald-300', bar: 'bg-emerald-400',
      chip: 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30',
      glow: 'bg-emerald-500/20',
    },
  },
  {
    key: 'veryGood', label: 'Very Good', min: 80,
    hex: { base: '#22c55e', soft: '#dcfce7', strong: '#166534' },
    chip: 'bg-green-100 text-green-800',
    tint: 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100',
    accent: 'text-green-700', wash: 'from-green-50', bar: 'bg-green-500',
    onDark: {
      text: 'text-green-400', bar: 'bg-green-400',
      chip: 'bg-green-400/15 text-green-300 ring-1 ring-green-400/30',
      glow: 'bg-green-500/20',
    },
  },
  {
    key: 'good', label: 'Good', min: 60,
    hex: { base: '#84cc16', soft: '#ecfccb', strong: '#3f6212' },
    chip: 'bg-lime-100 text-lime-900',
    tint: 'border-lime-200 bg-lime-50 text-lime-800 hover:bg-lime-100',
    accent: 'text-lime-800', wash: 'from-lime-50', bar: 'bg-lime-500',
    onDark: {
      text: 'text-lime-400', bar: 'bg-lime-400',
      chip: 'bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/30',
      glow: 'bg-lime-500/20',
    },
  },
  {
    key: 'satisfactory', label: 'Satisfactory', min: 40,
    hex: { base: '#f59e0b', soft: '#fef3c7', strong: '#92400e' },
    chip: 'bg-amber-100 text-amber-800',
    tint: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
    accent: 'text-amber-700', wash: 'from-amber-50', bar: 'bg-amber-500',
    onDark: {
      text: 'text-amber-400', bar: 'bg-amber-400',
      chip: 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30',
      glow: 'bg-amber-500/20',
    },
  },
  {
    key: 'poor', label: 'Poor', min: -Infinity,
    hex: { base: '#e30613', soft: '#fde3e5', strong: '#9e0812' },
    chip: 'bg-cyrixRed-100 text-cyrixRed-800',
    tint: 'border-cyrixRed-200 bg-cyrixRed-50 text-cyrixRed-800 hover:bg-cyrixRed-100',
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
  /**
   * The same four as average MARKS rather than shares.
   *
   * Both are needed and neither replaces the other. A manager thinks in
   * marks, because 80 + 20 = 100 is the shape of the KPI they agreed,
   * and "77.4% of 80%" asks them to reach for a calculator to get back
   * to it. But 61.9 against 15.2 cannot answer the question they opened
   * the screen for — whether the team is weaker on job role or on core
   * values. Only the shares compare.
   */
  marks: BandScores
  /**
   * What each band was out of, where that is the same for everybody.
   * Core values is 20 normally and 15 for anyone carrying ESMS, so a
   * mixed team has no single number and this is null.
   */
  outOf: { job: number | null; esms: number | null; core: number | null }
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

  // The marks themselves, averaged the same way and over the same
  // people, so the two figures on a tile always describe one thing.
  const rawEach = people
    .map(p => ({
      job: mean(p.months.map(m => m.job)),
      esms: mean(p.months.map(m => m.esms)),
      core: mean(p.months.map(m => m.core)),
      total: mean(p.months.map(m => m.total)),
    }))
    .filter(p => p.job !== null || p.esms !== null || p.core !== null || p.total !== null)

  /** One number, or null where the team does not share one. */
  const shared = (pick: (w: BandWeights) => number): number | null => {
    const seen = [...new Set(people.map(p => pick(p.weights)))]
    return seen.length === 1 ? seen[0] : null
  }

  return {
    job: mean(each.map(p => p.job)),
    esms: mean(each.map(p => p.esms)),
    core: mean(each.map(p => p.core)),
    total: mean(each.map(p => p.total)),
    marks: {
      job: mean(rawEach.map(p => p.job)),
      esms: mean(rawEach.map(p => p.esms)),
      core: mean(rawEach.map(p => p.core)),
      total: mean(rawEach.map(p => p.total)),
    },
    outOf: {
      job: shared(w => w.job),
      esms: shared(w => w.esms),
      core: shared(w => w.core),
    },
    people: each.length,
    anyEsms: people.some(p => p.weights.esms > 0),
  }
}

/**
 * The statuses that mean a month has actually been marked.
 *
 * 'finalized' is 'scored' that has since closed; both are a real figure
 * from a manager. Anything else on a submission is the person's own
 * self-assessment, which is not a score and must never be averaged into
 * one.
 */
export const SCORED_STATUSES = new Set(['scored', 'finalized'])

/**
 * Every manager's own team average, keyed by the manager.
 *
 * Fed the rows of a reporting line — each carrying who it reports to —
 * it answers "how is the team under this person doing" for every person
 * in it at once, which is what lets a list of managers show each team's
 * standing without a query per row.
 *
 * Only scored months count. Somebody who has not been assessed yet is
 * absent from their team's figure rather than a zero in it: averaging in
 * the unscored would report a team as failing for not having been
 * looked at, which is the opposite of what the colour is for.
 *
 * A manager with nobody scored is simply not in the map. That is a
 * different answer from a low average and the caller has to be able to
 * tell them apart.
 */
export function teamAverages(
  rows: Array<{
    reporting_manager_id: string | null
    submission_status: string | null
    final_total_score: number | null
  }>,
): Map<string, number> {
  const byManager = new Map<string, number[]>()
  for (const row of rows) {
    if (!row.reporting_manager_id) continue
    if (!SCORED_STATUSES.has(row.submission_status ?? '')) continue
    if (row.final_total_score === null) continue
    const scores = byManager.get(row.reporting_manager_id) ?? []
    scores.push(Number(row.final_total_score))
    byManager.set(row.reporting_manager_id, scores)
  }
  return new Map(
    [...byManager].map(([id, scores]) => [
      id,
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    ]),
  )
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
