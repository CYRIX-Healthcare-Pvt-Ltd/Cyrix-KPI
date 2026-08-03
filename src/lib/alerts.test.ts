import { describe, it, expect } from 'vitest'
import { newlyArrived } from './alerts'

/**
 * The rule that decides whether to make a sound.
 *
 * Every case here is one somebody would only notice by being pinged at
 * the wrong moment — on every page refresh, or for work they had just
 * finished — which is exactly the kind of bug that gets an app muted and
 * never reported.
 */

const ACTION = new Set(['approvals', 'scoring', 'records_manager'])
const isAction = (k: string) => ACTION.has(k)

const rows = (o: Record<string, number>) =>
  Object.entries(o).map(([kind, n]) => ({ kind, n }))

const before = (o: Record<string, number>) => new Map(Object.entries(o))

describe('what is worth a ping', () => {
  it('says nothing on the first load, however much is waiting', () => {
    expect(newlyArrived(null, rows({ approvals: 9, scoring: 4 }), isAction)).toEqual([])
  })

  it('pings for a kind that was not there before', () => {
    const out = newlyArrived(before({}), rows({ approvals: 1 }), isAction)
    expect(out.map(r => r.kind)).toEqual(['approvals'])
  })

  it('pings when the count goes up', () => {
    const out = newlyArrived(before({ approvals: 2 }), rows({ approvals: 3 }), isAction)
    expect(out.map(r => r.kind)).toEqual(['approvals'])
  })

  it('stays quiet when the count is unchanged', () => {
    expect(newlyArrived(before({ approvals: 2 }), rows({ approvals: 2 }), isAction)).toEqual([])
  })

  it('stays quiet when work is cleared — doing three of four is not an event', () => {
    expect(newlyArrived(before({ approvals: 4 }), rows({ approvals: 1 }), isAction)).toEqual([])
  })

  it('ignores news, however new — those get a dot, not a sound', () => {
    const out = newlyArrived(
      before({}), rows({ kpi_approved: 1, month_scored: 3 }), isAction,
    )
    expect(out).toEqual([])
  })

  it('picks the action item out of a batch that also carries news', () => {
    const out = newlyArrived(
      before({ approvals: 1 }),
      rows({ approvals: 2, kpi_approved: 1, month_scored: 2 }),
      isAction,
    )
    expect(out.map(r => r.kind)).toEqual(['approvals'])
  })

  it('reports every kind that rose, so the caller can choose', () => {
    const out = newlyArrived(
      before({ approvals: 1, scoring: 0 }),
      rows({ approvals: 2, scoring: 5, records_manager: 1 }),
      isAction,
    )
    expect(out.map(r => r.kind).sort())
      .toEqual(['approvals', 'records_manager', 'scoring'])
  })

  it('does not ping again for something that merely stayed', () => {
    // Read the panel, work sits there, next poll returns the same rows.
    const snapshot = before({ approvals: 2, scoring: 1 })
    expect(newlyArrived(snapshot, rows({ approvals: 2, scoring: 1 }), isAction)).toEqual([])
  })
})
