import { describe, it, expect } from 'vitest'
import { manualOffer } from './seenHelp'

/**
 * The reported bug: somebody four months into their year, averaging 94,
 * asked "New here? See what you can do".
 *
 * The rule had come to rest on a localStorage flag, and localStorage is
 * per-origin — so moving the app to app.cyrix.in forgot, for the whole
 * company at once, that any of them had ever read the manual.
 *
 * Which is the point of these: a browser's memory can never be the thing
 * that decides whether somebody is new. The database knows.
 */
const offer = (over: Partial<Parameters<typeof manualOffer>[0]> = {}) =>
  manualOffer({ kpiActive: true, monthsScored: 4, hasRead: true, ...over })

describe('offering the manual on the dashboard', () => {
  it('never asks an established person, whatever their browser forgot', () => {
    // The exact case reported, and then the same case after a domain
    // move, a new phone, a cleared cache or a private window — every one
    // of which looks identical from here.
    expect(offer()).toBe('none')
    expect(offer({ hasRead: false })).toBe('none')
  })

  it('is loud while there is no working KPI', () => {
    // The screen behind it is empty and explains none of itself.
    for (const monthsScored of [0, 3]) {
      expect(offer({ kpiActive: false, monthsScored })).toBe('loud')
    }
  })

  it('keeps being loud even for somebody who has read it', () => {
    // Skimming the manual before your KPI exists is not the same as
    // reading it once there is something to be measured against.
    expect(offer({ kpiActive: false, monthsScored: 0, hasRead: true })).toBe('loud')
  })

  it('offers quietly to somebody approved but not yet scored', () => {
    expect(offer({ monthsScored: 0, hasRead: false })).toBe('quiet')
  })

  it('retires the quiet offer as soon as it is taken', () => {
    expect(offer({ monthsScored: 0, hasRead: true })).toBe('none')
  })

  it('stops asking the month the first score lands', () => {
    expect(offer({ monthsScored: 0, hasRead: false })).toBe('quiet')
    expect(offer({ monthsScored: 1, hasRead: false })).toBe('none')
  })

  it('only ever lets the read flag hide the offer, never raise it', () => {
    // If a browser loses the flag the worst case must be one extra card
    // for somebody genuinely new — never a card for somebody who is not.
    const louder = { none: 0, quiet: 1, loud: 2 }
    for (const kpiActive of [true, false]) {
      for (const monthsScored of [0, 1, 12]) {
        const read = manualOffer({ kpiActive, monthsScored, hasRead: true })
        const forgotten = manualOffer({ kpiActive, monthsScored, hasRead: false })
        expect(louder[forgotten]).toBeGreaterThanOrEqual(louder[read])
      }
    }
  })
})
