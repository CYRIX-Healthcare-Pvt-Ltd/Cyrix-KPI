import { describe, it, expect } from 'vitest'
import { needsStartMonth, SETUP_PATH } from './startMonth'
import type { AssignmentStatus } from '@/types/db'

const asg = (starts_from: string | null, status: AssignmentStatus = 'active') =>
  ({ starts_from, status })

/**
 * The reported bug: submit a new KPI having filled the start month in on
 * the form, and the "one quick question" modal appears for a second and
 * goes.
 *
 * It was not a rendering glitch. The assignment was created without a
 * start month and the month written a round trip later, and the first of
 * those two calls refreshes every screen — so for as long as the second
 * took, the honest answer to "is anybody still to be asked" was yes.
 *
 * Both halves of the fix are load-bearing and neither is enough alone.
 * The insert now carries the month, so the gap does not exist for a new
 * KPI; and the modal stays off the setup form, which covers a draft that
 * was already missing one and is being edited right now.
 */
describe('who still needs asking', () => {
  it('asks somebody whose KPI has no start month', () => {
    expect(needsStartMonth(asg(null), '/')).toBe(true)
    expect(needsStartMonth(asg(null), '/my-kpi')).toBe(true)
    expect(needsStartMonth(asg(null, 'pending_approval'), '/my-kpi')).toBe(true)
    expect(needsStartMonth(asg(null, 'draft'), '/history')).toBe(true)
  })

  it('never asks somebody who has one', () => {
    for (const path of ['/', '/my-kpi', SETUP_PATH, '/history']) {
      expect(needsStartMonth(asg('2026-06-01'), path)).toBe(false)
    }
  })

  it('says nothing to somebody with no KPI at all', () => {
    expect(needsStartMonth(null, '/')).toBe(false)
    expect(needsStartMonth(undefined, '/')).toBe(false)
  })

  it('stays off the form that asks the same question', () => {
    // Landing on the person who is filling the field in as they read it.
    expect(needsStartMonth(asg(null, 'draft'), SETUP_PATH)).toBe(false)
    expect(needsStartMonth(asg(null, 'draft'), `${SETUP_PATH}?from=excel`)).toBe(false)
    // But the page next door is fair game.
    expect(needsStartMonth(asg(null, 'draft'), '/my-kpi')).toBe(true)
  })

  it('leaves a sent-back KPI alone, wherever they are', () => {
    // They are on their way to the setup form; the question is waiting
    // for them there, in a field they can change their mind about.
    for (const path of ['/', '/my-kpi', SETUP_PATH]) {
      expect(needsStartMonth(asg(null, 'rejected'), path)).toBe(false)
    }
  })
})
