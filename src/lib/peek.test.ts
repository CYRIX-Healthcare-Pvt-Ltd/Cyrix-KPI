import { describe, it, expect } from 'vitest'
import { shouldPeek, dayKey } from './peek'

const noon = new Date(2026, 8, 12, 12, 0)

describe('Cyra leaning out', () => {
  it('leans out when something is waiting and it has not today', () => {
    expect(shouldPeek({ things: 2, lastShown: null, now: noon })).toBe(true)
    expect(shouldPeek({ things: 2, lastShown: '2026-09-11', now: noon })).toBe(true)
  })

  it('only once a day', () => {
    expect(shouldPeek({ things: 2, lastShown: '2026-09-12', now: noon })).toBe(false)
  })

  it('says nothing when nothing is waiting', () => {
    expect(shouldPeek({ things: 0, lastShown: null, now: noon })).toBe(false)
  })

  it('stays out of the way of the open panel and the shared logins', () => {
    expect(shouldPeek({ things: 2, lastShown: null, panelOpen: true, now: noon })).toBe(false)
    expect(shouldPeek({ things: 2, lastShown: null, systemAccount: true, now: noon })).toBe(false)
  })

  it('counts the day by the reader’s clock, not by UTC', () => {
    // 06:30 in India is still the previous day in UTC. A UTC key would
    // let the bubble show twice to the early shift.
    expect(dayKey(new Date(2026, 8, 12, 6, 30))).toBe('2026-09-12')
    expect(dayKey(new Date(2026, 8, 12, 23, 59))).toBe('2026-09-12')
    expect(dayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })
})
