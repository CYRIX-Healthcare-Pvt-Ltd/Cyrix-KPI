import { describe, it, expect } from 'vitest'
import { TIPS, tipsFor, pickTip } from './tips'
import { CHAT } from './chat-strings'
import { READY_LANGS } from './i18n'

/** A team member with a KPI and a scored month — the ordinary case. */
const member = {
  isManager: false, isHrAdmin: false, hasKpi: true, hasScoredMonth: true,
}

describe('did-you-know tips', () => {
  it('has a sentence for every tip, in every language', () => {
    for (const tip of TIPS) {
      const phrase = CHAT[tip.key]
      expect(phrase, `${tip.key} has no text at all`).toBeDefined()
      // READY_LANGS holds objects, not codes — the code is on .code.
      for (const { code } of READY_LANGS) {
        expect(phrase[code], `${tip.key} is missing ${code}`).toBeTruthy()
      }
    }
  })

  it('never offers a team member a screen they cannot open', () => {
    const theirs = tipsFor({ ...member, isManager: false })
    expect(theirs.some(t => t.to === '/approvals')).toBe(false)
    expect(theirs.some(t => t.to === '/team')).toBe(false)
    expect(theirs.some(t => t.to === '/team/templates')).toBe(false)
  })

  it('gives a manager their own tools as well as everybody else’s', () => {
    const mine = tipsFor({ ...member, isManager: true })
    expect(mine.some(t => t.to === '/team/templates')).toBe(true)
    expect(mine.some(t => t.to === '/me')).toBe(true)
    expect(mine.length).toBeGreaterThan(tipsFor(member).length)
  })

  it('does not mention a rank to somebody with no scored month', () => {
    // "See where you stand" is a hollow offer before anything is scored,
    // and so is "query a score you disagree with".
    const fresh = tipsFor({ ...member, hasScoredMonth: false })
    expect(fresh.some(t => t.key === 'tip.rank')).toBe(false)
    expect(fresh.some(t => t.key === 'tip.query')).toBe(false)
  })

  it('does not talk about KPI rows to somebody with no KPI', () => {
    const none = tipsFor({ ...member, hasKpi: false })
    expect(none.some(t => t.key === 'tip.split')).toBe(false)
    expect(none.some(t => t.key === 'tip.alternates')).toBe(false)
    // The app-wide ones still apply — they are true of anybody.
    expect(none.some(t => t.key === 'tip.manual')).toBe(true)
  })

  it('works through the whole list before repeating one', () => {
    const list = tipsFor(member)
    const seen = list.map((_, i) => pickTip(member, i)!.key)
    expect(new Set(seen).size).toBe(list.length)
    // And wraps rather than running out.
    expect(pickTip(member, list.length)!.key).toBe(seen[0])
  })

  it('survives a device that has never seen one, and a nonsense count', () => {
    expect(pickTip(member, 0)).not.toBeNull()
    expect(pickTip(member, -5)).not.toBeNull()
    expect(pickTip(member, 9999)).not.toBeNull()
  })

  it('has something to say to somebody on their first day', () => {
    const brandNew = {
      isManager: false, isHrAdmin: false, hasKpi: false, hasScoredMonth: false,
    }
    expect(tipsFor(brandNew).length).toBeGreaterThan(0)
    expect(pickTip(brandNew, 0)).not.toBeNull()
  })
})
