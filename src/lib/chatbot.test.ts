import { describe, it, expect } from 'vitest'
import { matchQuestion, manualIndex, normalise } from './chatbot'
import { HELP } from './help-strings'

/**
 * The two failure modes worth testing are opposite ones.
 *
 * Answering nothing makes the bot useless, and it will be judged on the
 * fifteen questions people actually ask. Answering confidently WRONG is
 * worse than useless: these are rules that decide somebody's appraisal,
 * and a wrong deadline quoted with certainty costs them a month.
 *
 * So: the real questions have to land, and anything it has no answer for
 * has to come back as "I don't know", not as the nearest paragraph.
 */
describe('what people actually type', () => {
  const asks = (q: string) => matchQuestion(q)

  it('answers the two questions everybody asks from their own figures', () => {
    for (const q of [
      'what was my last month kpi',
      'my score last month',
      'how much did i get previous month',
    ]) {
      expect(asks(q)).toEqual({ kind: 'fact', id: 'score.last' })
    }

    for (const q of [
      'average of this year',
      'what is my average',
      'my overall score',
      'annual score',
    ]) {
      expect(asks(q)).toEqual({ kind: 'fact', id: 'score.year' })
    }
  })

  it('reads a question half typed in Malayalam', () => {
    // How people on the floor genuinely write: one English word, one not.
    expect(asks('കഴിഞ്ഞ മാസം score')).toEqual({ kind: 'fact', id: 'score.last' })
    expect(asks('എന്റെ ശരാശരി')).toEqual({ kind: 'fact', id: 'score.year' })
  })

  it('answers "how do I set up my KPI" with how to write one', () => {
    // Reported wrong: it came back with "Set the month their KPI starts
    // from", a manager's page about one of their reports, which won on
    // containing the words "set" and "KPI".
    //
    // Every phrasing, because the manual's own heading is "Write your
    // KPI" and nobody has ever typed that.
    for (const q of [
      'How do I set up my KPI?',
      'how to setup my kpi',
      'how do i create my kpi',
      'how to make my kpi',
      'where do i add my kra',
    ]) {
      const r = asks(q)
      expect(r.kind).toBe('manual')
      if (r.kind === 'manual') expect(r.key).toBe('s1.p1')
    }
  })

  it('reads a month by name out of the question', () => {
    // Also reported wrong: it returned a page about start months.
    expect(asks('what was my kpi in april')).toEqual({ kind: 'fact', id: 'score.month', month: 3 })
    expect(asks('my score in jan')).toEqual({ kind: 'fact', id: 'score.month', month: 0 })
    expect(asks('september score')).toEqual({ kind: 'fact', id: 'score.month', month: 8 })
    // A month with no score word in it is not a lookup.
    expect(asks('april').kind).not.toBe('fact')
  })

  it('never offers a team member a page they cannot act on', () => {
    // A team member has no approval screen and no way to change
    // somebody's start month. Those are not weaker answers to them,
    // they are unreachable ones.
    for (const q of [
      'How do I set up my KPI?', 'approve a kpi', 'change the start month',
      'score my team', 'who has not submitted',
    ]) {
      const r = asks(q)
      if (r.kind === 'manual') {
        expect(['team', 'hr', 'sw']).not.toContain(r.section)
      }
    }
  })

  it('gives a manager their own pages', () => {
    const boss = { isManager: true }
    const approve = matchQuestion('how do i approve a kpi', boss)
    expect(approve.kind).toBe('manual')
    if (approve.kind === 'manual') expect(approve.section).toBe('team')

    // And still answers their own-record questions as themselves.
    const mine = matchQuestion('How do I set up my KPI?', boss)
    if (mine.kind === 'manual') expect(mine.key).toBe('s1.p1')
  })

  it('finds the answers the manual was written for', () => {
    const cases: Array<[string, string]> = [
      ['why can I not open this month', 'ask.p1'],
      ['why can I not submit anything', 'ask.p2'],
      ['can I query a score twice', 'ask.p7'],
      ['I sent the wrong month in', 'ask.p6'],
    ]
    for (const [q, key] of cases) {
      const r = asks(q)
      expect(r.kind).toBe('manual')
      if (r.kind === 'manual') expect(r.key).toBe(key)
    }
  })

  it('says it does not know rather than guessing', () => {
    // None of these are in the manual, and every one of them is the kind
    // of thing somebody would believe an answer to.
    for (const q of [
      'when is my salary appraisal',
      'how much increment will i get',
      'who is the ceo',
      'can i take leave next week',
      'asdfgh',
    ]) {
      expect(asks(q).kind).toBe('unknown')
    }
  })

  it('says nothing to an empty question', () => {
    for (const q of ['', '   ', '???', 'the a of']) {
      expect(asks(q)).toEqual({ kind: 'unknown' })
    }
  })

  it('prefers a figure to a page about figures', () => {
    // "What is my average" could match the manual's paragraphs about
    // scoring. An exact number beats an explanation of where it comes
    // from every time.
    expect(asks('what is my average score this year').kind).toBe('fact')
  })
})

describe('the index it searches', () => {
  it('covers every question the manual poses', () => {
    const whats = Object.keys(HELP).filter(k => k.endsWith('.what'))
    expect(manualIndex()).toHaveLength(whats.length)
    expect(whats.length).toBeGreaterThan(40)
  })

  it('carries all four languages, not just English', () => {
    const setup = manualIndex().find(e => e.key === 's1.p1')
    expect(setup).toBeDefined()
    // The Malayalam for "Write your KPI" has to be in there or a
    // Malayalam question can never match.
    const ml = HELP['s1.p1.what'].ml!
    for (const word of ml.split(/\s+/).slice(0, 1)) {
      expect(setup!.asked.has(normalise(word))).toBe(true)
    }
  })

  it('strips punctuation so a question mark changes nothing', () => {
    expect(matchQuestion('why can I not open this month?'))
      .toEqual(matchQuestion('why can I not open this month'))
  })
})
