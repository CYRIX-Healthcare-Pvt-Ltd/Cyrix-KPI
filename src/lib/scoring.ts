/**
 * Scoring engine — TypeScript mirror of calc_kpi_score() in
 * supabase/migrations/0004_scoring.sql.
 *
 * The database is the source of truth; this exists so the assessment
 * form can show a live score as the user types, without a round trip.
 * scoring.test.ts asserts both produce identical numbers for the same
 * cases the SQL self-test covers.
 *
 * If you change a rule here, change it there too.
 */

export type ScoringRule =
  | 'higher_capped'
  | 'higher_uncapped'
  | 'lower_penalty'
  | 'lower_linear'
  | 'banded'
  | 'boolean'
  | 'rating_scale'

export interface RuleParams {
  /** Permit the score to fall below zero. Default false. */
  allow_negative?: boolean
  /** Explicit lower bound; overrides allow_negative. */
  floor?: number
  /** For higher_uncapped: ceiling as a multiple of the weightage (1.2 = 120%). */
  max_multiplier?: number
  /** For lower_linear when target is 0: flat penalty per unit over. */
  penalty_per_unit?: number
  /** For banded: thresholds, evaluated on achieved/target as a percentage. */
  bands?: Array<{ min_pct: number; award_pct: number }>
  /** For banded: award when no band matches. Default 0. */
  default_award_pct?: number
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/**
 * Score one KPI row.
 *
 * @param rule       which behaviour this KRA follows
 * @param weightage  the row's share of 100 (e.g. 25 for 25%)
 * @param target     the target value; may legitimately be 0
 * @param achieved   what was actually achieved; null = not entered yet
 */
export function calcKpiScore(
  rule: ScoringRule,
  weightage: number,
  target: number | null,
  achieved: number | null,
  params: RuleParams = {},
): number {
  const wt = weightage ?? 0

  // Not entered yet — the spreadsheet's ISBLANK(...)=0 branch.
  // Note this is null, not zero: a real achieved value of 0 falls through
  // and is scored, which is what makes "target 0, repeat calls 0" pay out
  // the full weightage.
  if (achieved === null || achieved === undefined) return 0

  let result: number

  switch (rule) {
    case 'higher_capped':
      result = !target ? 0 : Math.min((achieved / target) * wt, wt)
      break

    case 'higher_uncapped': {
      if (!target) { result = 0; break }
      result = (achieved / target) * wt
      if (params.max_multiplier != null) {
        result = Math.min(result, wt * params.max_multiplier)
      }
      break
    }

    case 'lower_penalty':
      if (target === null || target === undefined) result = 0
      else if (achieved <= target) result = wt
      else if (achieved === 0) result = 0
      else result = wt * (target / achieved)
      break

    case 'lower_linear':
      if (target === null || target === undefined) result = 0
      else if (achieved <= target) result = wt
      else if (target === 0) result = wt - achieved * (params.penalty_per_unit ?? wt)
      else result = wt * (1 - (achieved - target) / target)
      break

    case 'banded': {
      if (!target) { result = 0; break }
      const achPct = (achieved / target) * 100
      let bestAward = params.default_award_pct ?? null
      for (const band of params.bands ?? []) {
        if (achPct >= band.min_pct && (bestAward === null || band.award_pct > bestAward)) {
          bestAward = band.award_pct
        }
      }
      result = (wt * (bestAward ?? 0)) / 100
      break
    }

    case 'boolean':
      result = achieved >= 1 ? wt : 0
      break

    case 'rating_scale':
      result = Math.min((achieved / 100) * wt, wt)
      break

    default: {
      const never: never = rule
      throw new Error(`Unknown scoring rule: ${never}`)
    }
  }

  if (params.floor != null) result = Math.max(result, params.floor)
  else if (!params.allow_negative) result = Math.max(result, 0)

  return round4(result)
}

/** Excellent=100 … Poor=20, matching the template's nested IF chain. */
export const RATING_SCALE = [
  { label: 'Excellent', points: 100 },
  { label: 'Very Good', points: 80 },
  { label: 'Good', points: 60 },
  { label: 'Satisfactory', points: 40 },
  { label: 'Poor', points: 20 },
] as const

export type RatingLabel = (typeof RATING_SCALE)[number]['label']

export const ratingToPoints = (label: string | null | undefined): number | null =>
  RATING_SCALE.find(r => r.label === label)?.points ?? null

/**
 * Average the core-value ratings into the 0–100 figure that feeds the
 * core values row. Mirrors F8=AVERAGE(E11:E15).
 * Unrated values are excluded rather than counted as zero.
 */
export function averageCoreValueRatings(
  ratings: Array<string | null | undefined>,
): number | null {
  const points = ratings.map(ratingToPoints).filter((p): p is number => p !== null)
  if (points.length === 0) return null
  return round4(points.reduce((a, b) => a + b, 0) / points.length)
}

/** How self and manager scores blend. Defaults match AVERAGE(G,K). */
export interface ScoreBlend {
  self_weight: number
  manager_weight: number
}
export const DEFAULT_BLEND: ScoreBlend = { self_weight: 0.5, manager_weight: 0.5 }

/**
 * The final per-row score.
 *
 * Returns null until the manager has actually entered a value. The
 * spreadsheet used AVERAGE(G,K), which silently halved the score while
 * the manager column was still blank — we deliberately don't repeat that.
 */
export function blendScores(
  selfScore: number | null,
  managerScore: number | null,
  blend: ScoreBlend = DEFAULT_BLEND,
): number | null {
  if (managerScore === null || managerScore === undefined) return null
  return round4(
    blend.self_weight * (selfScore ?? 0) + blend.manager_weight * managerScore,
  )
}

export interface ScorableRow {
  section: 'job_role' | 'core_values'
  weightage: number
  target_value: number | null
  scoring_rule: ScoringRule
  rule_params: RuleParams
  self_achieved: number | null
  manager_achieved: number | null
}

export interface SectionTotals {
  jobRole: number
  coreValues: number
  total: number
}

export interface SubmissionTotals {
  self: SectionTotals
  manager: SectionTotals | null
  final: SectionTotals | null
}

/**
 * Roll a set of rows up into the three subtotals shown on screen.
 *
 * The manager and final blocks stay null until at least one row has been
 * scored by the manager, so the dashboard never shows a misleadingly low
 * "final" figure for a month nobody has reviewed yet.
 */
export function computeTotals(
  rows: ScorableRow[],
  blend: ScoreBlend = DEFAULT_BLEND,
): SubmissionTotals {
  const sum = (
    pick: (r: ScorableRow) => number | null,
    section?: 'job_role' | 'core_values',
  ) =>
    rows
      .filter(r => !section || r.section === section)
      .reduce((acc, r) => acc + (pick(r) ?? 0), 0)

  const selfOf = (r: ScorableRow) =>
    calcKpiScore(r.scoring_rule, r.weightage, r.target_value, r.self_achieved, r.rule_params)

  const mgrOf = (r: ScorableRow) =>
    r.manager_achieved === null || r.manager_achieved === undefined
      ? null
      : calcKpiScore(r.scoring_rule, r.weightage, r.target_value, r.manager_achieved, r.rule_params)

  const finalOf = (r: ScorableRow) => blendScores(selfOf(r), mgrOf(r), blend)

  const anyManagerScored = rows.some(r => mgrOf(r) !== null)

  const build = (pick: (r: ScorableRow) => number | null): SectionTotals => ({
    jobRole: round4(sum(pick, 'job_role')),
    coreValues: round4(sum(pick, 'core_values')),
    total: round4(sum(pick)),
  })

  return {
    self: build(selfOf),
    manager: anyManagerScored ? build(mgrOf) : null,
    final: anyManagerScored ? build(finalOf) : null,
  }
}
