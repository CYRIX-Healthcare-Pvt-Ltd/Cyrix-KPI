import { describe, it, expect } from 'vitest'
import { fyMonths, fyMonthsFrom, openFyMonthsFrom, monthLabel } from './fy'

const FY = '2026-27'

describe('fyMonthsFrom', () => {
  it('gives the whole year when nobody has said when it starts', () => {
    expect(fyMonthsFrom(FY, null)).toEqual(fyMonths(FY))
    expect(fyMonthsFrom(FY, undefined)).toEqual(fyMonths(FY))
  })

  it('drops the months before a June joiner arrived', () => {
    const months = fyMonthsFrom(FY, '2026-06-01')
    expect(months).toHaveLength(10)
    expect(monthLabel(months[0])).toBe('Jun-26')
    expect(months).not.toContain('2026-04-01')
    expect(months).not.toContain('2026-05-01')
  })

  it('includes the start month itself', () => {
    expect(fyMonthsFrom(FY, '2026-06-01')).toContain('2026-06-01')
  })

  it('keeps the year in order across the January rollover', () => {
    const months = fyMonthsFrom(FY, '2026-12-01')
    expect(months).toEqual([
      '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01',
    ])
  })

  it('leaves nothing when the KPI starts after the year ends', () => {
    expect(fyMonthsFrom(FY, '2027-04-01')).toEqual([])
  })

  it('is a plain string compare, so no timezone can shift a month', () => {
    // The bug this guards against is Date parsing '2026-06-01' as UTC and
    // rendering it as 31 May in Asia/Kolkata — which would silently
    // include May for a June joiner.
    expect(fyMonthsFrom(FY, '2026-06-01')[0]).toBe('2026-06-01')
  })
})

describe('openFyMonthsFrom', () => {
  // Fixed "today" so the assertion does not rot: reporting month is the
  // previous one, so on 15 Sep 2026 the last assessable month is August.
  const today = new Date(2026, 8, 15)

  it('stops at the last finished month and starts at the KPI', () => {
    expect(openFyMonthsFrom(FY, '2026-06-01', today)).toEqual([
      '2026-06-01', '2026-07-01', '2026-08-01',
    ])
  })

  it('is empty for a KPI that has not reached a finished month yet', () => {
    expect(openFyMonthsFrom(FY, '2026-09-01', today)).toEqual([])
  })
})
