import { describe, it, expect } from 'vitest'
import { waitingForScore, waitingCaption } from './waiting'

/**
 * The reported bug: "Waiting for my score" read 0 while the first row of
 * My Team was a July assessment still waiting. The tile counted the month
 * on screen, and the month on screen was August.
 *
 * Then the rule that came with the fix: people, not months. Somebody three
 * months behind is one person to get back to.
 */
const sub = (employee_id: string, period_month: string, status = 'submitted') =>
  ({ employee_id, period_month, status })

const team = new Set(['e1', 'e2', 'e3'])

describe('who is waiting for my score', () => {
  it('counts a month that is not the one being reported on', () => {
    const w = waitingForScore([sub('e1', '2026-07-01')], team)
    expect(w.people).toBe(1)
    expect(w.months).toEqual(['2026-07-01'])
  })

  it('counts somebody with three months waiting once', () => {
    const w = waitingForScore([
      sub('e3', '2026-06-01'),
      sub('e3', '2026-07-01'),
      sub('e3', '2026-08-01'),
    ], team)
    expect(w.people).toBe(1)
    expect(w.months).toHaveLength(3)
  })

  it('counts only what is waiting on the manager', () => {
    // Scored and finalised are done; a draft or a returned month is back
    // with the team member and not the manager's to act on.
    const w = waitingForScore([
      sub('e1', '2026-08-01', 'scored'),
      sub('e2', '2026-08-01', 'finalized'),
      sub('e3', '2026-08-01', 'draft'),
      sub('e3', '2026-07-01', 'returned'),
    ], team)
    expect(w).toEqual({ people: 0, months: [] })
  })

  it('ignores anybody who is not in this team', () => {
    const w = waitingForScore([sub('e9', '2026-08-01')], team)
    expect(w.people).toBe(0)
  })

  it('lists each month once, oldest first, whatever order they arrive in', () => {
    const w = waitingForScore([
      sub('e2', '2026-08-01'),
      sub('e1', '2026-06-01'),
      sub('e3', '2026-08-01'),
    ], team)
    expect(w.people).toBe(3)
    expect(w.months).toEqual(['2026-06-01', '2026-08-01'])
  })
})

describe('the line under the count', () => {
  it('says the scope when nobody is waiting, so 0 cannot read as one month', () => {
    expect(waitingCaption([])).toBe('all months')
  })

  it('names the month when there is one', () => {
    expect(waitingCaption(['2026-07-01'])).toBe('Jul-26')
  })

  it('names the oldest when there are several', () => {
    expect(waitingCaption(['2026-06-01', '2026-08-01'])).toBe('oldest Jun-26')
  })
})
