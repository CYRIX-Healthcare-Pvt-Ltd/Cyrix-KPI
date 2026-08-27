import { describe, it, expect } from 'vitest'
import { officialEmailProblem, isOfficialEmail, OFFICIAL_DOMAIN } from './officialEmail'

describe('what counts as an official address', () => {
  it('accepts the shape 1,101 employees actually have', () => {
    for (const e of [
      'kevin.r@cyrix.in',
      'saranya.ks@cyrix.in',
      'no-reply@cyrix.in',
      'a@cyrix.in',
    ]) {
      expect(officialEmailProblem(e)).toBeNull()
      expect(isOfficialEmail(e)).toBe(true)
    }
  })

  it('does not care about case or stray spaces', () => {
    // Typed on a phone by somebody who is locked out and cross.
    for (const e of ['  Kevin.R@Cyrix.IN ', 'KEVIN.R@CYRIX.IN']) {
      expect(officialEmailProblem(e)).toBeNull()
    }
  })

  it('turns a personal address away', () => {
    // The real one on file today: E272, Manoj Kumar.
    expect(officialEmailProblem('manojkcyrix@gmail.com'))
      .toBe(`Use your official @${OFFICIAL_DOMAIN} email, not a personal one`)
    expect(isOfficialEmail('someone@outlook.com')).toBe(false)
  })

  it('is not fooled by a domain that merely ends in cyrix.in', () => {
    // "Ending with cyrix.in" is the obvious reading and the wrong test.
    // Anybody can register the second one of these.
    for (const e of [
      'kevin@notcyrix.in',
      'kevin@my-cyrix.in',
      'kevin@cyrix.in.example.com',
      'kevin@evilcyrix.in',
    ]) {
      expect(isOfficialEmail(e)).toBe(false)
    }
  })

  it('is not fooled by a second @ either', () => {
    // The domain is what follows the LAST @, which is what a mail server
    // reads. Taking the first would call this one official.
    expect(isOfficialEmail('kevin@cyrix.in@evil.com')).toBe(false)

    // A quoted local part containing an @ is legal RFC 5322 and is
    // refused anyway. Nobody at Cyrix has one, it cannot match a record
    // that does not exist, and the alternative is parsing quoted strings
    // in a field whose only job is to catch a typed gmail address.
    expect(isOfficialEmail('"kevin@evil.com"@cyrix.in')).toBe(false)
  })

  it('says nothing at all about an empty field', () => {
    // Not yet a mistake. A form that scolds before you have typed reads
    // as broken.
    expect(officialEmailProblem('')).toBeNull()
    expect(officialEmailProblem('   ')).toBeNull()
    // But empty is still not something to send to.
    expect(isOfficialEmail('')).toBe(false)
  })

  it('asks somebody mid-way to finish rather than telling them off', () => {
    for (const half of ['kevin', 'kevin.r', 'kevin@']) {
      expect(officialEmailProblem(half))
        .toBe(`Finish the email — official ones end in @${OFFICIAL_DOMAIN}`)
    }
  })

  it('rejects a domain that is right with nothing in front of it', () => {
    expect(officialEmailProblem('@cyrix.in')).toBe('That does not look like an email address')
    expect(officialEmailProblem('a b@cyrix.in')).toBe('That does not look like an email address')
  })

  it('never returns an empty message when it returns one at all', () => {
    // The message is the entire point; a blank one is a disabled button
    // with no explanation next to it.
    for (const e of ['x', 'x@y.com', '@cyrix.in', 'a b@cyrix.in', 'x@notcyrix.in']) {
      const problem = officialEmailProblem(e)
      expect(problem).not.toBeNull()
      expect(problem!.length).toBeGreaterThan(10)
    }
  })
})
