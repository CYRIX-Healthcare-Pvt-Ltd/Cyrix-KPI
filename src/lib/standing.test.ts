import { describe, it, expect } from 'vitest'
import { standingLines, pickStanding, type StandingContext, type TeamStanding } from './standing'
import { CHAT } from './chat-strings'
import { READY_LANGS } from './i18n'

/** Somebody in the middle of the field with a weak KRA — the ordinary case. */
const member: StandingContext = {
  rank: 42, of: 177,
  lever: { kra: 'FTFR', target: 80, gain: 6.25 },
  climb: null,
  team: null,
}

const team = (over: Partial<TeamStanding> = {}): TeamStanding => ({
  rank: 13, of: 177,
  scoreLate: 0, scoreAllowance: 5,
  submitLate: 0, submitAllowance: 3,
  due: 60, scored: 60,
  average: 71.2,
  lowest: null,
  ...over,
})

describe('what Cyra says about where you stand', () => {
  it('has a sentence for every line it can produce, in every language', () => {
    const everything: StandingContext = {
      ...member,
      climb: { soFar: 68, recent: 80 },
      team: team({
        scoreLate: 2.4, submitLate: 1.1, scored: 41,
        lowest: { id: 'e2', name: 'Abik A R', score: 34 },
      }),
    }
    const keys = new Set([
      ...standingLines(everything).map(l => l.key),
      ...standingLines({ ...member, rank: 3 }).map(l => l.key),
      ...standingLines({ ...member, lever: null }).map(l => l.key),
    ])
    // Every branch, or this test is only checking the ones it happened
    // to reach.
    expect(keys.size).toBe(10)
    for (const key of keys) {
      const phrase = CHAT[key]
      expect(phrase, `${key} has no text at all`).toBeDefined()
      for (const { code } of READY_LANGS) {
        expect(phrase[code], `${key} is missing ${code}`).toBeTruthy()
      }
    }
  })

  it('gives a manager their team before their own score', () => {
    const lines = standingLines({
      ...member,
      team: team({ lowest: { id: 'e2', name: 'Abik A R', score: 34 } }),
    })
    expect(lines[0].key).toBe('stand.mgrlowest')
    expect(lines[0].to).toBe('/team/e2')
    // Their own rank is still offered, after the team.
    expect(lines.map(l => l.key)).toContain('stand.ranklever')
    expect(lines.findIndex(l => l.key === 'stand.ranklever'))
      .toBeGreaterThan(lines.findIndex(l => l.key === 'stand.mgrrank'))
  })

  it('names nobody when the lowest person is doing fine', () => {
    const lines = standingLines({
      ...member,
      team: team({ lowest: { id: 'e2', name: 'Abik A R', score: 78 } }),
    })
    expect(lines.some(l => l.key === 'stand.mgrlowest')).toBe(false)
  })

  it('never sends a team member a manager line', () => {
    for (const line of standingLines(member)) {
      expect(line.key.startsWith('stand.mgr')).toBe(false)
    }
  })

  it('mentions a clock only when it is actually late', () => {
    const onTime = standingLines({ ...member, team: team() }).map(l => l.key)
    expect(onTime).not.toContain('stand.mgrslow')
    expect(onTime).not.toContain('stand.mgrlate')
    const late = standingLines({
      ...member, team: team({ scoreLate: 2.4, submitLate: 1.1 }),
    })
    expect(late.find(l => l.key === 'stand.mgrslow')?.vars)
      .toEqual({ days: '2.4', allow: 5 })
    expect(late.find(l => l.key === 'stand.mgrlate')?.vars)
      .toEqual({ days: '1.1', allow: 3 })
  })

  it('says the months not scored, because coverage multiplies the lot', () => {
    const lines = standingLines({ ...member, team: team({ due: 60, scored: 41 }) })
    expect(lines.find(l => l.key === 'stand.mgrdone')?.vars).toEqual({ done: 41, due: 60 })
    // Nothing to say once they are all done.
    expect(standingLines({ ...member, team: team() }).some(l => l.key === 'stand.mgrdone'))
      .toBe(false)
  })

  it('congratulates the top ten instead of handing them a lever', () => {
    const lines = standingLines({ ...member, rank: 7 })
    expect(lines[0].key).toBe('stand.ranktop')
    expect(lines.some(l => l.key === 'stand.ranklever')).toBe(false)
  })

  it('always gives somebody outside the top ten the next move', () => {
    // The reported worry: 160 of 177 must never be a bare position.
    const line = standingLines({ ...member, rank: 160 })[0]
    expect(line.key).toBe('stand.ranklever')
    expect(line.vars).toEqual({ rank: 160, of: 177, kra: 'FTFR', target: 80, gain: '6.3' })
  })

  it('states the position plainly when there is no lever to offer', () => {
    expect(standingLines({ ...member, lever: null })[0].key).toBe('stand.rank')
  })

  it('says nothing about a field of one, which is not a position', () => {
    expect(standingLines({ ...member, of: 1, rank: 1, lever: null })).toEqual([])
    const alone = standingLines({
      ...member, lever: null, team: team({ rank: 1, of: 1 }),
    })
    expect(alone.some(l => l.key === 'stand.mgrrank')).toBe(false)
  })

  it('only claims a climb when the recent months are actually higher', () => {
    expect(standingLines({ ...member, lever: null, climb: { soFar: 80, recent: 68 } })
      .some(l => l.key === 'stand.climb')).toBe(false)
    expect(standingLines({ ...member, lever: null, climb: { soFar: 68, recent: 80 } })
      .find(l => l.key === 'stand.climb')?.vars).toEqual({ soFar: '68.0', recent: '80.0' })
  })

  it('rotates, so a fortnight of openings is not one sentence fourteen times', () => {
    const ctx = { ...member, team: team({ scoreLate: 2, submitLate: 1, scored: 41 }) }
    const list = standingLines(ctx)
    const seen = new Set(list.map((_, i) => pickStanding(ctx, i)!.key))
    expect(seen.size).toBe(list.length)
    // And it comes back round rather than running out.
    expect(pickStanding(ctx, list.length)!.key).toBe(list[0].key)
  })

  it('says nothing at all when there is nothing true to say', () => {
    expect(pickStanding({ rank: null, of: null, lever: null, climb: null, team: null }, 0))
      .toBeNull()
  })
})
