import { describe, it, expect } from 'vitest'
import {
  calcKpiScore,
  averageCoreValueRatings,
  blendScores,
  computeTotals,
  ruleTraits,
  type ScorableRow,
  type ScoringRule,
} from './scoring'

/**
 * Every expected value below is derived from the real formulas in
 * "KPI 26-27 Template.xlsx", sheet Apr-26. These cases are duplicated as
 * assertions in migration 0007 so the SQL and TS engines cannot drift.
 */

describe('higher_capped — MIN(F/E*D, D)', () => {
  it('pays the full weightage on target', () => {
    // Response time: wt 25, target 100
    expect(calcKpiScore('higher_capped', 25, 100, 100)).toBe(25)
  })

  it('scales linearly below target', () => {
    expect(calcKpiScore('higher_capped', 25, 100, 50)).toBe(12.5)
    expect(calcKpiScore('higher_capped', 25, 100, 80)).toBe(20)
  })

  it('caps at the weightage when the target is exceeded', () => {
    expect(calcKpiScore('higher_capped', 25, 100, 150)).toBe(25)
    expect(calcKpiScore('higher_capped', 25, 100, 1000)).toBe(25)
  })

  it('returns 0 for a zero target, matching IFERROR', () => {
    expect(calcKpiScore('higher_capped', 25, 0, 50)).toBe(0)
  })
})

describe('higher_uncapped — overachievement can cross the weightage', () => {
  it('goes past the weightage', () => {
    expect(calcKpiScore('higher_uncapped', 25, 100, 150)).toBe(37.5)
  })

  it('respects max_multiplier as a ceiling', () => {
    expect(calcKpiScore('higher_uncapped', 25, 100, 150, { max_multiplier: 1.2 })).toBe(30)
    expect(calcKpiScore('higher_uncapped', 25, 100, 110, { max_multiplier: 1.2 })).toBe(27.5)
  })
})

describe('lower_penalty — exceeding the target reduces the score', () => {
  it('reproduces the Documentation & Reporting row', () => {
    // wt 20, target 35, achieved 40  ->  20 * 35/40 = 17.5
    expect(calcKpiScore('lower_penalty', 20, 35, 40)).toBe(17.5)
  })

  it('pays full weightage at or under target', () => {
    expect(calcKpiScore('lower_penalty', 20, 35, 35)).toBe(20)
    expect(calcKpiScore('lower_penalty', 20, 35, 10)).toBe(20)
  })

  it('handles the zero-target Service quality row', () => {
    // "Repeated call within one month should be 0"
    expect(calcKpiScore('lower_penalty', 10, 0, 0)).toBe(10)
    expect(calcKpiScore('lower_penalty', 10, 0, 1)).toBe(0)
    expect(calcKpiScore('lower_penalty', 10, 0, 5)).toBe(0)
  })

  it('decays further the more the target is exceeded', () => {
    const a = calcKpiScore('lower_penalty', 20, 35, 40)
    const b = calcKpiScore('lower_penalty', 20, 35, 70)
    const c = calcKpiScore('lower_penalty', 20, 35, 140)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
    expect(b).toBe(10) // exactly double the target -> half the weightage
  })
})

describe('lower_linear — negative scores', () => {
  it('goes negative when explicitly allowed', () => {
    // wt 10, target 5, achieved 15 -> 10 * (1 - 10/5) = -10
    expect(calcKpiScore('lower_linear', 10, 5, 15, { allow_negative: true })).toBe(-10)
  })

  it('goes negative without being asked, because that is its name', () => {
    // The rule is called "can go negative" on screen. Whether it could
    // used to depend on a flag the setup form set and the importer did
    // not, so the same rule behaved differently depending on where the
    // row came from.
    expect(calcKpiScore('lower_linear', 10, 5, 15)).toBe(-10)
  })

  it('still floors at zero when a row explicitly opts out', () => {
    expect(calcKpiScore('lower_linear', 10, 5, 15, { allow_negative: false })).toBe(0)
  })

  it('honours an explicit floor', () => {
    expect(calcKpiScore('lower_linear', 10, 5, 15, { allow_negative: true, floor: -5 })).toBe(-5)
  })

  it('pays full weightage at or under target', () => {
    expect(calcKpiScore('lower_linear', 10, 5, 5)).toBe(10)
  })
})

/**
 * "Monthly maximum one complaint. Every one after that costs 2% of the
 * total." The row is a penalty, not a share of the 80%, so it carries no
 * weightage — and that is exactly what stopped it working. Over target
 * the rule removed a proportional slice of the weightage, which is a
 * share of nothing, and the one figure quoted in points rather than
 * shares was only consulted when the target was 0.
 */
describe('lower_linear — a flat penalty on a row worth no weightage', () => {
  const complaint = { penalty_per_unit: 2 }

  it('costs nothing up to and including the allowance', () => {
    expect(calcKpiScore('lower_linear', 0, 1, 0, complaint)).toBe(0)
    expect(calcKpiScore('lower_linear', 0, 1, 1, complaint)).toBe(0)
  })

  it('takes the stated percentage off for each one over', () => {
    expect(calcKpiScore('lower_linear', 0, 1, 2, complaint)).toBe(-2)
    expect(calcKpiScore('lower_linear', 0, 1, 3, complaint)).toBe(-4)
    expect(calcKpiScore('lower_linear', 0, 1, 6, complaint)).toBe(-10)
  })

  it('is what turns a total of 90 into 88', () => {
    const rows: ScorableRow[] = [
      { section: 'job_role', weightage: 80, target_value: 100, scoring_rule: 'higher_capped',
        rule_params: {}, self_achieved: 87.5, manager_achieved: 87.5 },
      { section: 'core_values', weightage: 20, target_value: 100, scoring_rule: 'rating_scale',
        rule_params: {}, self_achieved: 100, manager_achieved: 100 },
      { section: 'job_role', weightage: 0, target_value: 1, scoring_rule: 'lower_linear',
        rule_params: complaint, self_achieved: null, manager_achieved: null },
    ]
    // 70 + 20, and a clean month on the complaints row.
    expect(computeTotals(rows).self.total).toBe(90)

    const twoComplaints = rows.map(r =>
      r.weightage === 0 ? { ...r, self_achieved: 2, manager_achieved: 2 } : r)
    expect(computeTotals(twoComplaints).self.total).toBe(88)

    const three = rows.map(r =>
      r.weightage === 0 ? { ...r, self_achieved: 3, manager_achieved: 3 } : r)
    expect(computeTotals(three).self.total).toBe(86)
  })

  it('allows a target of 0, where every one costs', () => {
    expect(calcKpiScore('lower_linear', 0, 0, 0, complaint)).toBe(0)
    expect(calcKpiScore('lower_linear', 0, 0, 1, complaint)).toBe(-2)
    expect(calcKpiScore('lower_linear', 0, 0, 2, complaint)).toBe(-4)
  })

  it('overrides the proportional slice on a row that has a weightage too', () => {
    // wt 10, target 2, achieved 4. The slice would be 0; the penalty is 3.
    expect(calcKpiScore('lower_linear', 10, 2, 4, { penalty_per_unit: 1.5 })).toBe(7)
  })

  it('leaves the target-0 fallback alone for rows without a penalty', () => {
    // One over wipes out the weightage, as it always has.
    expect(calcKpiScore('lower_linear', 10, 0, 1)).toBe(0)
    expect(calcKpiScore('lower_linear', 10, 0, 2)).toBe(-10)
  })

  it('scores nothing at all with neither a weightage nor a penalty', () => {
    // The state two live rows are in today, and the reason they have
    // never moved a total.
    expect(calcKpiScore('lower_linear', 0, 1, 9)).toBe(0)
  })

  it('reads 0% off as no penalty rather than a penalty of nothing', () => {
    // Otherwise a row carries the rule, shows a mark reading "-0% per
    // unit over", and can never take anything off. Nought falls back to
    // the proportional slice, which on a row worth 0% is still nothing —
    // so the setup form refuses to submit it.
    expect(calcKpiScore('lower_linear', 0, 1, 9, { penalty_per_unit: 0 })).toBe(0)
    expect(ruleTraits('lower_linear', 0, { penalty_per_unit: 0 }).map(t => t.label))
      .toEqual(['Nothing to score'])

    // And on a row that does have a weightage, the slice takes over.
    expect(calcKpiScore('lower_linear', 10, 2, 4, { penalty_per_unit: 0 })).toBe(0)
    expect(calcKpiScore('lower_linear', 10, 2, 5, { penalty_per_unit: 0 })).toBe(-5)
  })

  it('will not pay somebody for missing the target', () => {
    // A negative penalty would add marks for every one over. It reads
    // as unset, like 0.
    expect(calcKpiScore('lower_linear', 10, 2, 4, { penalty_per_unit: -3 })).toBe(0)
    expect(ruleTraits('lower_linear', 10, { penalty_per_unit: -3 }).map(t => t.tone))
      .not.toContain('bonus')
  })

  it('caps the damage when a floor is set', () => {
    expect(calcKpiScore('lower_linear', 0, 1, 99, { ...complaint, floor: -10 })).toBe(-10)
  })
})

describe('banded', () => {
  const bands = {
    bands: [
      { min_pct: 95, award_pct: 100 },
      { min_pct: 85, award_pct: 75 },
      { min_pct: 70, award_pct: 50 },
    ],
  }

  it('awards the highest matching band', () => {
    expect(calcKpiScore('banded', 20, 100, 97, bands)).toBe(20)
    expect(calcKpiScore('banded', 20, 100, 92, bands)).toBe(15)
    expect(calcKpiScore('banded', 20, 100, 72, bands)).toBe(10)
  })

  it('awards nothing below the lowest band', () => {
    expect(calcKpiScore('banded', 20, 100, 40, bands)).toBe(0)
  })
})

describe('boolean and rating_scale', () => {
  it('boolean is all or nothing', () => {
    expect(calcKpiScore('boolean', 15, 1, 1)).toBe(15)
    expect(calcKpiScore('boolean', 15, 1, 0)).toBe(0)
  })

  it('rating_scale maps 0-100 onto the weightage', () => {
    expect(calcKpiScore('rating_scale', 20, 100, 100)).toBe(20)
    expect(calcKpiScore('rating_scale', 20, 100, 60)).toBe(12)
    expect(calcKpiScore('rating_scale', 20, 100, 0)).toBe(0)
  })
})

describe('not-yet-entered values', () => {
  it('scores null as zero without crediting a zero-target rule', () => {
    // The distinction that matters: null means "blank", 0 means "achieved 0".
    expect(calcKpiScore('lower_penalty', 10, 0, null)).toBe(0)
    expect(calcKpiScore('lower_penalty', 10, 0, 0)).toBe(10)
  })
})

/**
 * The marks have to agree with the engine, or they are decoration that
 * lies. Each of these asserts the colour against what the arithmetic
 * actually does to a score.
 */
describe('rule traits — the red, green and grey marks', () => {
  const tones = (rule: ScoringRule, wt: number, params = {}) =>
    ruleTraits(rule, wt, params).map(t => t.tone)

  it('is red exactly when a score can end up below zero', () => {
    for (const [rule, wt, params] of [
      ['lower_linear', 10, {}],
      ['lower_linear', 0, { penalty_per_unit: 2 }],
      ['lower_linear', 10, { penalty_per_unit: 2 }],
    ] as Array<[ScoringRule, number, object]>) {
      // 20 units over any sane target is enough to prove it.
      expect(calcKpiScore(rule, wt, 1, 21, params)).toBeLessThan(0)
      expect(tones(rule, wt, params)).toContain('penalty')
    }
  })

  it('is never red for a rule that floors at zero', () => {
    for (const [rule, params] of [
      ['higher_capped', {}],
      ['higher_uncapped', {}],
      ['lower_penalty', {}],
      ['lower_linear', { allow_negative: false }],
    ] as Array<[ScoringRule, object]>) {
      expect(calcKpiScore(rule, 10, 1, 21, params)).toBeGreaterThanOrEqual(0)
    }
    expect(tones('higher_capped', 10)).not.toContain('penalty')
    expect(tones('lower_penalty', 10)).not.toContain('penalty')
  })

  it('is green exactly when a score can pass its weightage', () => {
    expect(calcKpiScore('higher_uncapped', 10, 50, 60)).toBeGreaterThan(10)
    expect(tones('higher_uncapped', 10)).toEqual(['bonus'])

    expect(calcKpiScore('higher_capped', 10, 50, 60)).toBe(10)
    expect(tones('higher_capped', 10)).toEqual(['capped'])
  })

  it('names the ceiling a multiplier actually imposes', () => {
    const [trait] = ruleTraits('higher_uncapped', 10, { max_multiplier: 1.2 })
    expect(trait.label).toBe('Up to 12%')
    expect(calcKpiScore('higher_uncapped', 10, 50, 1000, { max_multiplier: 1.2 })).toBe(12)
  })

  it('quotes the penalty a row is actually carrying', () => {
    const marks = ruleTraits('lower_linear', 0, { penalty_per_unit: 2 })
    expect(marks.map(m => m.label)).toEqual(['−2% per unit over'])
    // No "capped at 0%" — a ceiling of nothing is not worth a chip.
    expect(marks).toHaveLength(1)
  })

  it('says so when a row cannot change the total either way', () => {
    // Not only the penalty rule. A row worth 0% is a share of nothing
    // whichever way the arithmetic runs, so "Capped at 0%" is true and
    // useless — the reader needs to know the row does not count.
    for (const rule of [
      'lower_linear', 'higher_capped', 'higher_uncapped', 'lower_penalty',
    ] as ScoringRule[]) {
      expect(ruleTraits(rule, 0).map(m => m.label)).toEqual(['Nothing to score'])
      for (const achieved of [0, 1, 50, 99]) {
        expect(calcKpiScore(rule, 0, 1, achieved)).toBe(0)
      }
    }
  })

  it('never shows more than two marks', () => {
    const rules: ScoringRule[] = [
      'higher_capped', 'higher_uncapped', 'lower_penalty', 'lower_linear',
      'banded', 'boolean', 'rating_scale',
    ]
    for (const rule of rules) {
      for (const wt of [0, 10, 80]) {
        for (const params of [{}, { penalty_per_unit: 2 }, { max_multiplier: 1.5 }]) {
          const marks = ruleTraits(rule, wt, params)
          expect(marks.length).toBeGreaterThan(0)
          expect(marks.length).toBeLessThanOrEqual(2)
          for (const m of marks) {
            expect(m.label.length).toBeLessThanOrEqual(24)
            expect(m.detail.length).toBeGreaterThan(m.label.length)
          }
        }
      }
    }
  })
})

describe('core value roll-up — AVERAGE(E11:E15)', () => {
  it('averages the five ratings', () => {
    expect(
      averageCoreValueRatings(['Excellent', 'Excellent', 'Excellent', 'Excellent', 'Excellent']),
    ).toBe(100)
    expect(
      averageCoreValueRatings(['Excellent', 'Very Good', 'Good', 'Satisfactory', 'Poor']),
    ).toBe(60) // (100+80+60+40+20)/5
  })

  it('ignores unrated values rather than scoring them zero', () => {
    expect(averageCoreValueRatings(['Excellent', null, null, null, null])).toBe(100)
    expect(averageCoreValueRatings([null, null, null, null, null])).toBeNull()
  })

  it('feeds the 20% core values weightage correctly', () => {
    const avg = averageCoreValueRatings(['Excellent', 'Very Good', 'Good', 'Satisfactory', 'Poor'])
    expect(calcKpiScore('rating_scale', 20, 100, avg)).toBe(12)
  })
})

describe('blending self and manager', () => {
  it('averages the two, matching AVERAGE(G,K)', () => {
    expect(blendScores(20, 16)).toBe(18)
  })

  it('stays null until the manager has scored', () => {
    // The spreadsheet would have returned 10 here (half of 20). We don't.
    expect(blendScores(20, null)).toBeNull()
  })

  it('supports manager-only scoring', () => {
    expect(blendScores(25, 10, { self_weight: 0, manager_weight: 1 })).toBe(10)
  })
})

describe('full submission roll-up', () => {
  // The exact Service Engineer sheet, with the sample values from the file.
  const rows: ScorableRow[] = [
    { section: 'job_role', weightage: 25, target_value: 100, scoring_rule: 'higher_capped',
      rule_params: {}, self_achieved: 100, manager_achieved: 90 },
    { section: 'job_role', weightage: 25, target_value: 100, scoring_rule: 'higher_capped',
      rule_params: {}, self_achieved: 100, manager_achieved: 100 },
    { section: 'job_role', weightage: 20, target_value: 35, scoring_rule: 'lower_penalty',
      rule_params: {}, self_achieved: 40, manager_achieved: 40 },
    { section: 'job_role', weightage: 10, target_value: 0, scoring_rule: 'lower_penalty',
      rule_params: {}, self_achieved: 0, manager_achieved: 0 },
    { section: 'core_values', weightage: 20, target_value: 100, scoring_rule: 'rating_scale',
      rule_params: {}, self_achieved: 100, manager_achieved: 80 },
  ]

  it('splits job role and core values into the 80/20 blocks', () => {
    const t = computeTotals(rows)
    // 25 + 25 + 17.5 + 10 = 77.5
    expect(t.self.jobRole).toBe(77.5)
    expect(t.self.coreValues).toBe(20)
    expect(t.self.total).toBe(97.5)
  })

  it('computes the manager block independently', () => {
    const t = computeTotals(rows)
    // 22.5 + 25 + 17.5 + 10 = 75
    expect(t.manager?.jobRole).toBe(75)
    expect(t.manager?.coreValues).toBe(16)
    expect(t.manager?.total).toBe(91)
  })

  it('blends into the final score', () => {
    const t = computeTotals(rows)
    expect(t.final?.jobRole).toBe(76.25) // (77.5 + 75) / 2
    expect(t.final?.coreValues).toBe(18)
    expect(t.final?.total).toBe(94.25)
  })

  it('withholds manager and final totals until scoring starts', () => {
    const unscored = rows.map(r => ({ ...r, manager_achieved: null }))
    const t = computeTotals(unscored)
    expect(t.self.total).toBe(97.5)
    expect(t.manager).toBeNull()
    expect(t.final).toBeNull()
  })

  it('keeps job role within 80 and core values within 20 for a perfect month', () => {
    const perfect: ScorableRow[] = rows.map(r => ({
      ...r,
      self_achieved: r.scoring_rule === 'lower_penalty' ? (r.target_value ?? 0) : 100,
      manager_achieved: r.scoring_rule === 'lower_penalty' ? (r.target_value ?? 0) : 100,
    }))
    const t = computeTotals(perfect)
    expect(t.final?.jobRole).toBe(80)
    expect(t.final?.coreValues).toBe(20)
    expect(t.final?.total).toBe(100)
  })
})
