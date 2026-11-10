import { describe, expect, it } from 'vitest'
import { daysLeft, isPastLastDay, lastDayEnds, lastDayLabel, timeLeftText } from './lastDay'
import type { TatPolicy } from './queries'

const policy: TatPolicy = { tm_grace_days: 12, manager_grace_days: 15, starts_from: null, deadlines_from: '2026-09-01' }
const ist = (s: string) => new Date(s + '+05:30')

describe('last days', () => {
  it('ends at midnight in India after day N of the next month', () => {
    expect(lastDayEnds('2026-09-01', 'tm', policy)?.toISOString()).toBe('2026-10-12T18:30:00.000Z')
    expect(lastDayLabel('2026-09-01', 'tm', policy)).toBe('12 Oct')
    expect(lastDayLabel('2026-09-01', 'manager', policy)).toBe('15 Oct')
    expect(lastDayLabel('2027-03-01', 'tm', policy)).toBe('12 Apr')
  })
  it('does not apply before deadlines_from', () => {
    expect(lastDayEnds('2026-08-01', 'tm', policy)).toBeNull()
    expect(isPastLastDay('2026-08-01', 'tm', policy, ist('2027-01-01T00:00:00'))).toBe(false)
  })
  it('the 12th is still open, the 13th is not', () => {
    expect(isPastLastDay('2026-09-01', 'tm', policy, ist('2026-10-12T23:59:59'))).toBe(false)
    expect(isPastLastDay('2026-09-01', 'tm', policy, ist('2026-10-13T00:00:00'))).toBe(true)
    expect(daysLeft('2026-09-01', 'tm', policy, ist('2026-10-12T09:00:00'))).toBe(0)
    expect(daysLeft('2026-09-01', 'tm', policy, ist('2026-10-10T23:00:00'))).toBe(2)
  })
  it('a month opened on request keeps its own later last day (0273)', () => {
    const until = '2026-11-13T18:30:00+00:00' // to the end of 13 Nov in India
    expect(lastDayLabel('2026-09-01', 'tm', policy, until)).toBe('13 Nov')
    expect(isPastLastDay('2026-09-01', 'tm', policy, ist('2026-11-13T23:59:59'), until)).toBe(false)
    expect(isPastLastDay('2026-09-01', 'tm', policy, ist('2026-11-14T00:00:00'), until)).toBe(true)
    expect(lastDayLabel('2026-09-01', 'tm', policy, '2026-10-01T18:30:00+00:00')).toBe('12 Oct')
  })
  it('reads as days, hours and minutes, then with seconds inside a day', () => {
    expect(timeLeftText(((36 * 60) + 32) * 60_000, 'tm')).toBe('1 day 12 hr 32 min left to submit')
    expect(timeLeftText(((5 * 60 + 12) * 60 + 33) * 1000, 'manager')).toBe('5 hr 12 min 33 sec left to score')
  })
})
