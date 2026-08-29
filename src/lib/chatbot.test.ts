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

  it('knows its own name, and does not confuse it with the reader', () => {
    for (const q of [
      'who are you',
      'Who are you?',
      'who r u',
      'what is your name',
      'what should i call you',
      'are you a bot',
      'നീ ആരാണ്',
      'तुम कौन हो',
      'మీరు ఎవరు',
    ]) {
      expect(asks(q)).toEqual({ kind: 'fact', id: 'chit.whoisbot' })
    }

    // The reader's own identity is a different question and must stay
    // one — these two are a word apart and mean opposite things.
    expect(asks('who am i')).toEqual({ kind: 'fact', id: 'whoami' })
    expect(asks('what is my name')).toEqual({ kind: 'fact', id: 'whoami' })
  })

  it('does not answer a manager asking its name with a fact about their team', () => {
    // The trap: `who` is a TEAM_WORD, so before this was matched ahead of
    // the team branch, "who are you" reached the code that answers
    // questions about somebody's reports. A name asked for, an appraisal
    // score returned.
    const boss = { isManager: true, team: [{ ecode: 'E599', full_name: 'Vineesan Vazhayil' }] }
    expect(matchQuestion('who are you', boss)).toEqual({ kind: 'fact', id: 'chit.whoisbot' })
    expect(matchQuestion('what is your name', boss)).toEqual({ kind: 'fact', id: 'chit.whoisbot' })

    // And the real team questions are untouched.
    expect(matchQuestion('who is the highest in my team', boss).kind).toBe('fact')
    expect(matchQuestion('who is the highest in my team', boss))
      .toEqual({ kind: 'fact', id: 'team.highest', month: undefined })
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

  it('says hello back rather than failing its first exchange', () => {
    // Somebody opening with "hi" is not asking anything, and "I do not
    // know that one" is a poor first impression from a help panel.
    for (const q of ['hi', 'HI', 'hello', 'hey', 'Good morning']) {
      expect(asks(q)).toEqual({ kind: 'fact', id: 'chit.hello' })
    }
    // But not on a word that merely contains them.
    expect(asks('this achieved thing').kind).not.toBe('fact')
  })

  it('knows who it is talking to', () => {
    // It has their record open. Being asked and saying no reads as a bot
    // that knows nothing about you, right before you ask it your score.
    for (const q of ['what is my name', 'WHAT IS my name', 'who am i', 'my employee code']) {
      expect(asks(q)).toEqual({ kind: 'fact', id: 'whoami' })
    }
  })

  it('finds the best month however it is phrased', () => {
    // Reported: "which month has best?" returned a page about start
    // months, because the pattern was the literal string "best month".
    for (const q of ['which month has best?', 'best month', 'worst month',
                     'my highest score', 'what was my lowest score']) {
      expect(asks(q)).toEqual({ kind: 'fact', id: 'score.bestworst' })
    }
    // "best" alone is not a question about a month.
    expect(asks('who is the best engineer').kind).not.toBe('fact')
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

/**
 * The manager's half, found by using it as one.
 *
 * A manager with 16 reports asked "Lowest score teammember in july" and
 * was told her own July score. The panel had no idea a team existed —
 * every pattern in it was written in the first person.
 */
describe('a manager asking about their team', () => {
  const team = [
    { ecode: 'E2249', full_name: 'Rahul Tinil' },
    { ecode: 'E1895', full_name: 'Vineesh K R' },
    { ecode: 'E599', full_name: 'Vineesan Vazhayil' },
    { ecode: 'E2041', full_name: 'Sreenath K P' },
  ]
  const mgr = (q: string) => matchQuestion(q, { isManager: true, team })
  const tm = (q: string) => matchQuestion(q, { isManager: false })

  it('reads a team question as a team question', () => {
    expect(mgr('Lowest score teammember in july'))
      .toEqual({ kind: 'fact', id: 'team.lowest', month: 6 })
    expect(mgr('who is the highest in my team'))
      .toEqual({ kind: 'fact', id: 'team.highest', month: undefined })
    expect(mgr('who has not submitted yet').kind).toBe('fact')
    expect(mgr('how many people report to me'))
      .toEqual({ kind: 'fact', id: 'team.size' })
  })

  it('finds somebody named, by first name or employee code', () => {
    expect(mgr('how is Rahul doing'))
      .toEqual({ kind: 'fact', id: 'team.person', ecode: 'E2249', month: undefined })
    expect(mgr('E2041 score'))
      .toEqual({ kind: 'fact', id: 'team.person', ecode: 'E2041', month: undefined })
    expect(mgr('how did Rahul do in may'))
      .toEqual({ kind: 'fact', id: 'team.person', ecode: 'E2249', month: 4 })
  })

  it('does not confuse two people whose names start the same', () => {
    // Vineesh and Vineesan are both on this roster.
    expect(mgr('what about Vineesh')).toMatchObject({ ecode: 'E1895' })
    expect(mgr('what about Vineesan')).toMatchObject({ ecode: 'E599' })
  })

  it('offers none of it to somebody with no team', () => {
    // A team member asking the same words must never be handed a
    // colleague's figures — and cannot be, since the roster is empty.
    expect(tm('who is the lowest in my team').kind).not.toBe('fact')
    expect(tm('how is Rahul doing').kind).not.toBe('fact')
  })

  it('still knows when a manager is asking about themselves', () => {
    expect(mgr('who am i')).toEqual({ kind: 'fact', id: 'whoami' })
    expect(mgr('my score last month')).toEqual({ kind: 'fact', id: 'score.last' })
    expect(mgr('what is my average')).toEqual({ kind: 'fact', id: 'score.year' })
  })

  it('hears "how do I" as a question for the manual, not for a figure', () => {
    // "how do i score my team" was answered with the team's average, and
    // "what does ESMS mean" with their ESMS figure — the panel reaching
    // for data when the person wanted the procedure.
    for (const q of ['how do i score my team', 'how do i approve a kpi',
                     'what does ESMS mean', 'what is a KRA']) {
      expect(mgr(q).kind).toBe('manual')
    }
    // But a count is still a count.
    expect(mgr('how many people report to me').kind).toBe('fact')
  })

  it('answers a question made entirely of stop words', () => {
    // "what is this" has no token left after the stop list, and the
    // matcher used to give up before looking at a single pattern.
    expect(mgr('what is this')).toEqual({ kind: 'fact', id: 'manual' })
  })
})
