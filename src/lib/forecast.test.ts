import { describe, it, expect } from 'vitest'
import { forecastYear, biggestLever, averageRows, weakestOf } from './forecast'

const months = (...values: number[]) =>
  values.map((value, i) => ({
    period_month: `2026-${String(i + 4).padStart(2, '0')}-01`,
    value,
  }))

describe('forecastYear', () => {
  it('says nothing from one month', () => {
    expect(forecastYear(months(80), 11)).toBeNull()
    expect(forecastYear([], 12)).toBeNull()
  })

  it('projects a steady run as itself', () => {
    const f = forecastYear(months(80, 80, 80, 80), 8)!
    expect(f.soFar).toBe(80)
    expect(f.recent).toBe(80)
    expect(f.projected).toBe(80)
    expect(f.direction).toBe('flat')
  })

  it('pulls the projection toward the recent run, not all the way to it', () => {
    // Four months averaging 70, the last three at 80. Eight months left.
    const f = forecastYear(months(40, 80, 80, 80), 8)!
    expect(f.soFar).toBe(70)
    expect(f.recent).toBe(80)
    // (70*4 + 80*8) / 12 = 76.7 — between the two, nearer the recent run
    // because most of the year is still ahead.
    expect(f.projected).toBe(76.7)
    expect(f.projected).toBeGreaterThan(f.soFar)
    expect(f.projected).toBeLessThan(f.recent)
  })

  it('barely moves when the year is nearly over', () => {
    const f = forecastYear(months(40, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80), 1)!
    expect(f.projected).toBeCloseTo(f.soFar, 0)
  })

  it('is just the average when nothing is left', () => {
    const f = forecastYear(months(60, 90), 0)!
    expect(f.projected).toBe(75)
    expect(f.remaining).toBe(0)
  })

  it('calls a real climb up and a real slide down', () => {
    expect(forecastYear(months(50, 55, 75, 80), 8)!.direction).toBe('up')
    expect(forecastYear(months(90, 85, 60, 55), 8)!.direction).toBe('down')
  })

  it('does not call small drift a direction', () => {
    // Recent run one point above the average is noise, not a trend.
    expect(forecastYear(months(78, 79, 80, 81), 8)!.direction).toBe('flat')
  })

  it('grades its own confidence by how much it has seen', () => {
    expect(forecastYear(months(80, 80), 10)!.confidence).toBe('low')
    expect(forecastYear(months(80, 80, 80, 80), 8)!.confidence).toBe('fair')
    expect(forecastYear(months(80, 80, 80, 80, 80), 7)!.confidence).toBe('good')
  })

  it('reads months in date order however they arrive', () => {
    const ordered = forecastYear(months(40, 60, 90, 95), 8)!
    const shuffled = forecastYear([...months(40, 60, 90, 95)].reverse(), 8)!
    expect(shuffled).toEqual(ordered)
    // And "recent" really is the late months, not the first three.
    expect(ordered.recent).toBeCloseTo((60 + 90 + 95) / 3, 1)
  })

  it('ignores a negative remaining rather than inventing months', () => {
    expect(forecastYear(months(70, 80), -3)!.remaining).toBe(0)
  })
})

describe('biggestLever', () => {
  it('picks the row worth the most, not the one that looks worst', () => {
    const lever = biggestLever([
      // Visibly terrible, worth almost nothing: 5 * 0.5 = 2.5 points.
      { kra: 'Site reports', weightage: 5, attainmentPct: 40 },
      // Unremarkable, worth a great deal: 30 * 0.15 = 4.5 points.
      { kra: 'Closure rate', weightage: 30, attainmentPct: 75 },
    ])!
    expect(lever.kra).toBe('Closure rate')
    expect(lever.gain).toBe(4.5)
  })

  it('states the arithmetic it is claiming', () => {
    const lever = biggestLever([{ kra: 'Response time', weightage: 25, attainmentPct: 60 }])!
    // 25% of the score, 30 points of room -> 7.5 on the 100 scale.
    expect(lever).toMatchObject({ weightage: 25, attainmentPct: 60, target: 90, gain: 7.5 })
  })

  it('leaves alone a row that is already there', () => {
    expect(biggestLever([{ kra: 'Uptime', weightage: 40, attainmentPct: 95 }])).toBeNull()
    expect(biggestLever([{ kra: 'Uptime', weightage: 40, attainmentPct: 90 }])).toBeNull()
  })

  it('skips rows that cannot be acted on', () => {
    expect(biggestLever([
      { kra: 'Penalty row', weightage: 0, attainmentPct: 10 },
      { kra: 'Unscored', weightage: 20, attainmentPct: Number.NaN },
    ])).toBeNull()
  })

  it('takes a different target when asked', () => {
    const lever = biggestLever([{ kra: 'X', weightage: 20, attainmentPct: 50 }], 100)!
    expect(lever.gain).toBe(10)
  })

  it('says nothing about an empty KPI', () => {
    expect(biggestLever([])).toBeNull()
  })
})

describe('averageRows', () => {
  it('averages a row across its months', () => {
    const rows = averageRows([
      { kra: 'Response time', weightage: 25, attainment_pct: 60 },
      { kra: 'Response time', weightage: 25, attainment_pct: 80 },
    ])
    expect(rows).toEqual([{ kra: 'Response time', weightage: 25, attainmentPct: 70 }])
  })

  it('drops months a row was not scored in rather than counting them as zero', () => {
    const rows = averageRows([
      { kra: 'Response time', weightage: 25, attainment_pct: 80 },
      { kra: 'Response time', weightage: 25, attainment_pct: null },
    ])
    expect(rows[0].attainmentPct).toBe(80)
  })

  it('keeps the later weightage when a KPI was corrected mid-year', () => {
    const rows = averageRows([
      { kra: 'Response time', weightage: 20, attainment_pct: 60 },
      { kra: 'Response time', weightage: 30, attainment_pct: 60 },
    ])
    expect(rows[0].weightage).toBe(30)
  })

  it('feeds biggestLever the shape it wants', () => {
    const lever = biggestLever(averageRows([
      { kra: 'Small', weightage: 5, attainment_pct: 20 },
      { kra: 'Big', weightage: 40, attainment_pct: 70 },
      { kra: 'Big', weightage: 40, attainment_pct: 70 },
    ]))!
    expect(lever.kra).toBe('Big')
    expect(lever.gain).toBe(8)
  })
})

describe('weakestOf', () => {
  it('finds the lowest across its months, not its worst single month', () => {
    const worst = weakestOf([
      { id: 'delight', value: 40 }, { id: 'delight', value: 40 },
      // One bad month, strong otherwise — not the weakest overall.
      { id: 'trust', value: 20 }, { id: 'trust', value: 100 },
    ])!
    expect(worst.id).toBe('delight')
    expect(worst.pct).toBe(40)
  })

  it('ignores months a value was not rated in', () => {
    const worst = weakestOf([
      { id: 'care', value: 80 }, { id: 'care', value: null },
      { id: 'speed', value: 60 },
    ])!
    expect(worst.id).toBe('speed')
  })

  it('says nothing when nothing has been rated', () => {
    expect(weakestOf([])).toBeNull()
    expect(weakestOf([{ id: 'a', value: null }])).toBeNull()
  })
})
