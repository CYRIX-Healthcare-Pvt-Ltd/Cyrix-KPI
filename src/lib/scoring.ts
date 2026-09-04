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

/**
 * How far past its weightage an uncapped row may go: as far as it goes.
 *
 * There was a ceiling here — 120% of the weightage, so a 25% row could
 * earn at most 30 — added on management's instruction and withdrawn on
 * theirs after the demo. Their reasoning both times was about ranking:
 * an uncapped row can carry a whole year, and somebody outstanding on
 * one KRA and poor on the rest should not top a list. That is a real
 * problem and a ceiling was the wrong tool for it, because it solved a
 * ranking question by falsifying a score. Migration 0096 ranks on band
 * slabs instead, which fixes it where it lives, so the score is free to
 * say what actually happened.
 *
 * undefined means no ceiling. A row may still declare its own
 * max_multiplier and that is honoured — a KPI is entitled to say where
 * its own bonus stops.
 *
 * calc_kpi_score (migration 0095) is the scorer that decides an
 * appraisal; this one is what the screen shows while somebody types.
 * They have to agree, and scoring.test.ts checks the arithmetic here
 * against the same cases.
 */
export const UNCAPPED_MAX_MULTIPLIER: number | undefined = undefined

export interface RuleParams {
  /** Permit the score to fall below zero. Default false. */
  allow_negative?: boolean
  /** Explicit lower bound; overrides allow_negative. */
  floor?: number
  /** For higher_uncapped: ceiling as a multiple of the weightage (1.2 = 120%). */
  max_multiplier?: number
  /**
   * For either lower rule: points off for each unit over the target.
   *
   * Points on the total out of 100, which is what makes a row worth no
   * weightage at all still able to do something: "one complaint a month
   * is allowed, each one after that costs 2%". Set, it replaces the
   * proportional slice at every target — including 0, which is the only
   * place it used to apply.
   *
   * Taken by lower_penalty too. The two lower rules differ in one thing
   * and it is the thing their names say — one stops at zero, the other
   * keeps going down — so the rate a unit costs is a separate question
   * from the floor, and both of them get to answer it.
   */
  penalty_per_unit?: number
  /** For banded: thresholds, evaluated on achieved/target as a percentage. */
  bands?: Array<{ min_pct: number; award_pct: number }>
  /** For banded: award when no band matches. Default 0. */
  default_award_pct?: number
}

const round4 = (n: number) => {
  const r = Math.round(n * 1e4) / 1e4
  // Negative zero is a real value in JavaScript, and (-0).toFixed(2) is
  // the string "-0.00". A penalty row that took nothing off — weightage
  // 0 minus a slice of 0 — lands there, so a clean month would have been
  // shown as a deduction. Postgres numeric has no such value, so this is
  // also what keeps the two engines agreeing.
  return r === 0 ? 0 : r
}

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
      // No ceiling unless the row states one. Triple the target and the
      // row is worth triple — see UNCAPPED_MAX_MULTIPLIER for why the
      // 120% cap that used to sit here has gone.
      const mult = params.max_multiplier ?? UNCAPPED_MAX_MULTIPLIER
      result = (achieved / target) * wt
      if (mult !== undefined) result = Math.min(result, wt * mult)
      break
    }

    case 'lower_penalty': {
      if (target === null || target === undefined) { result = 0; break }
      if (achieved <= target) { result = wt; break }
      // A stated rate per unit over, exactly as lower_linear takes one.
      // The two rules now differ in one thing and it is the thing their
      // names say: this one stops at zero, the other keeps going down.
      // Before, only one of them could be told what a unit costs, so
      // "1% off per complaint, but never below zero" could not be
      // expressed at all -- you picked the floor you wanted and accepted
      // whatever penalty came with it.
      //
      // Unset falls through to the proportional curve, which is what
      // every row written before today relies on.
      const perUnit = params.penalty_per_unit
      if (perUnit != null && perUnit > 0) result = wt - (achieved - target) * perUnit
      else if (achieved === 0) result = 0
      else result = wt * (target / achieved)
      break
    }

    case 'lower_linear': {
      if (target === null || target === undefined) { result = 0; break }
      if (achieved <= target) { result = wt; break }
      const over = achieved - target
      // A stated penalty wins at every target. The proportional slice is
      // a share of the weightage, so on a row carrying no weightage it
      // is a share of nothing — which is how "max 1 complaint" rows came
      // to be worth 0 whatever happened. A figure in points has
      // something to take away from.
      //
      // Zero is not a penalty, it is the absence of one, so it reads as
      // unset rather than as "takes nothing off" — otherwise a row could
      // carry a rule that provably never fires and still look configured.
      const perUnit = params.penalty_per_unit
      if (perUnit != null && perUnit > 0) result = wt - over * perUnit
      // Target 0 has no proportional base either. Falling back to the
      // weightage means one over wipes the row out, which is the
      // behaviour that shipped and is kept for rows relying on it.
      else if (target === 0) result = wt - over * wt
      else result = wt * (1 - over / target)
      break
    }

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

  // The rule named on screen is "can go negative", so it can, unless the
  // row says otherwise. It used to depend on a flag the setup form
  // remembered to set and the Excel importer did not, which made the
  // label true or false depending on where the row came from.
  const allowNegative = params.allow_negative ?? rule === 'lower_linear'

  if (params.floor != null) result = Math.max(result, params.floor)
  else if (!allowNegative) result = Math.max(result, 0)

  return round4(result)
}

/**
 * What a rule is allowed to do to a score, said in one or two marks.
 *
 * The picker's description is three sentences of prose with a worked
 * example on somebody else's numbers, and it appears in exactly one
 * place — the setup form. Everywhere the row is seen afterwards, on the
 * approval screen, the monthly assessment and the manager's scoring, the
 * rule is a lowercase phrase in grey and the reader has no way to tell
 * that this row can quietly take points off the total.
 *
 * So the three things worth knowing get a colour each, and they travel
 * with the row:
 *
 *   grey   the score stops at the weightage and cannot go below zero
 *   green  beating the target earns more than the weightage
 *   red    going over the target takes points off, past zero if it must
 *
 * Never more than two marks. The ceiling and the floor are the whole
 * story, and a row of chips is as unreadable as the sentence it replaced.
 */
export type TraitTone = 'capped' | 'bonus' | 'penalty'

export interface RuleTrait {
  tone: TraitTone
  /** Short enough for a chip. */
  label: string
  /** The same thing said properly, for a tooltip. */
  detail: string
}

const pct = (n: number) => `${round4(n)}%`

export function ruleTraits(
  rule: ScoringRule,
  weightage: number,
  params: RuleParams = {},
): RuleTrait[] {
  const wt = weightage ?? 0
  const capped: RuleTrait = {
    tone: 'capped',
    label: `Max ${pct(wt)}`,
    detail: `Beating the target earns nothing extra — this row stops at ${pct(wt)} — and it cannot go below zero.`,
  }

  // Same reading as the engine: 0% off per unit is no penalty at all.
  const penalty = rule === 'lower_linear'
    && params.penalty_per_unit != null
    && params.penalty_per_unit > 0
      ? params.penalty_per_unit
      : null

  // The one thing a row carrying no weightage can still do.
  if (penalty !== null) {
    return [
      ...(wt > 0 ? [capped] : []),
      {
        tone: 'penalty',
        label: `−${pct(penalty)} per unit over`,
        detail: `Every unit over the target takes ${pct(penalty)} off the total score, and keeps taking it — this row can pull the total down.`,
      },
    ]
  }

  // Nothing to weigh and nothing to take off. Whichever rule is named,
  // the arithmetic is a share of zero: this row cannot move the total in
  // either direction, all year.
  if (wt === 0) {
    return [{
      tone: 'capped',
      label: 'Nothing to score',
      detail: 'This row is worth 0%, so it cannot change the total either way. Give it a weightage — or, on a penalty row, a % to take off for each one over the target.',
    }]
  }

  switch (rule) {
    case 'higher_uncapped': {
      const mult = params.max_multiplier ?? UNCAPPED_MAX_MULTIPLIER
      // A row that names its own ceiling says where it stops; one that
      // does not has none, and the chip has to say which of the two this
      // is. "Up to 30%" on a row with no ceiling was the old cap's
      // wording and would now be a promise the scorer does not keep.
      return [mult === undefined
        ? {
            tone: 'bonus' as const,
            label: 'No ceiling',
            detail: `Beating the target earns more than the ${pct(wt)} weightage, with no upper limit — double the target is double the marks.`,
          }
        : {
            tone: 'bonus' as const,
            label: `Up to ${pct(wt * mult)}`,
            detail: `Beating the target earns more than the ${pct(wt)} weightage, as far as ${pct(wt * mult)} — ${Math.round(mult * 100)}% of it.`,
          }]
    }

    // A working penalty is already handled above; what is left is the
    // proportional slice, which keeps going after it runs out.
    case 'lower_linear':
      return [capped, {
        tone: 'penalty',
        label: 'Can go below zero',
        detail: `Every unit over the target removes an equal slice of the ${pct(wt)}. Enough of them take this row past zero, which comes off the total.`,
      }]

    case 'lower_penalty':
      return [{
        tone: 'capped',
        label: `Max ${pct(wt)}`,
        detail: `At or under the target earns the full ${pct(wt)}. Going over reduces it, gently, and never below zero.`,
      }]

    case 'boolean':
      return [{
        tone: 'capped',
        label: 'All or nothing',
        detail: `Done earns the full ${pct(wt)}; not done earns nothing.`,
      }]

    // higher_capped, banded and rating_scale all stop at the weightage
    // and all floor at zero.
    default:
      return [capped]
  }
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

/**
 * How far below somebody's own assessment a manager may score without
 * explaining themselves.
 *
 * Points on the total out of 100, not a percentage of it, and not per
 * row: a row worth 5% marked one unit lower is a large proportional cut
 * and nothing anybody needs a paragraph about. The total is the number
 * the team member sees and the number they would otherwise query.
 *
 * Mirrored in migration 0045 as `cut_at`, which is the one that actually
 * enforces it. If this moves, move that.
 */
export const SCORE_CUT_POINTS = 5
