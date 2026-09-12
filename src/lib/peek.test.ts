import { describe, it, expect } from 'vitest'
import { shouldPeek, dayKey } from './peek'

/** Something waiting, nothing read, nothing dismissed. */
const fresh = { waiting: 2, unread: true, dismissed: null }

describe('Cyra leaning out', () => {
  it('leans out when something is unread', () => {
    expect(shouldPeek(fresh)).toBe(true)
  })

  it('says nothing when there is nothing to say', () => {
    expect(shouldPeek({ ...fresh, waiting: 0 })).toBe(false)
  })

  it('stops the moment the panel has been opened', () => {
    // Opening it is reading it. The only way to keep seeing the bubble
    // is to keep not looking, which is why this cannot nag.
    expect(shouldPeek({ ...fresh, unread: false })).toBe(false)
  })

  it('stays away for the rest of the day once it is dismissed', () => {
    expect(shouldPeek({ ...fresh, dismissed: dayKey() })).toBe(false)
  })

  it('comes back the next day, still unread', () => {
    expect(shouldPeek({ ...fresh, dismissed: '2026-09-11', now: new Date(2026, 8, 12, 9) }))
      .toBe(true)
  })

  it('never interrupts an open panel', () => {
    expect(shouldPeek({ ...fresh, panelOpen: true })).toBe(false)
  })

  it('never greets a shared login', () => {
    // SW_ADMIN and the other underscore codes have nobody on the far end.
    expect(shouldPeek({ ...fresh, systemAccount: true })).toBe(false)
  })
})

describe('the day it counts by', () => {
  it('is the reader\'s own, not UTC', () => {
    // Half past six in the morning in India is still yesterday in UTC,
    // and a UTC key would let a dismissal expire mid-morning.
    expect(dayKey(new Date(2026, 8, 12, 6, 30))).toBe('2026-09-12')
    expect(dayKey(new Date(2026, 8, 12, 23, 59))).toBe('2026-09-12')
    expect(dayKey(new Date(2026, 8, 13, 0, 1))).toBe('2026-09-13')
  })

  it('pads, so the strings compare as dates do', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
