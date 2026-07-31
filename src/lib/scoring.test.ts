import { describe, it, expect } from 'vitest'
import {
  calcKpiScore,
  averageCoreValueRatings,
  blendScores,
  computeTotals,
  type ScorableRow,
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

  it('floors at zero by default', () => {
    expect(calcKpiScore('lower_linear', 10, 5, 15)).toBe(0)
  })

  it('honours an explicit floor', () => {
    expect(calcKpiScore('lower_linear', 10, 5, 15, { allow_negative: true, floor: -5 })).toBe(-5)
  })

  it('pays full weightage at or under target', () => {
    expect(calcKpiScore('lower_linear', 10, 5, 5)).toBe(10)
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
