import { describe, it, expect } from 'vitest'
import { LANGS, READY_LANGS, KEEP_ENGLISH, say, placeholdersIn } from './i18n'
import { HELP } from './help-strings'

const TRANSLATED = READY_LANGS.filter(l => l.code !== 'en')

/**
 * Matches the term at a word start, so plurals count — "KRAs" is still
 * KRA — while "shrunk" is not HR and "through" is not HR either.
 * Malayalam characters are not word characters, so "KPI-യിൽ" still
 * matches KPI.
 */
const uses = (text: string, term: string) =>
  new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)

describe('the manual', () => {
  it('has English for every string', () => {
    for (const [key, phrase] of Object.entries(HELP)) {
      expect(phrase.en, `${key} has no English`).toBeTruthy()
    }
  })

  it.each(TRANSLATED)('is complete in $english', ({ code }) => {
    const missing = Object.entries(HELP)
      .filter(([, phrase]) => !phrase[code as 'ml'])
      .map(([key]) => key)

    // A language is only offered once it is finished, so a gap here is
    // either a string somebody forgot or a language marked ready too
    // early. Both show as a page half in English.
    expect(missing, `${missing.length} string(s) missing`).toEqual([])
  })

  it.each(TRANSLATED)('keeps the software\'s own words in English in $english', ({ code }) => {
    const broken: string[] = []

    for (const [key, phrase] of Object.entries(HELP)) {
      const translated = phrase[code as 'ml']
      if (!translated) continue
      for (const term of KEEP_ENGLISH) {
        if (uses(phrase.en, term) && !uses(translated, term)) {
          broken.push(`${key}: "${term}"`)
        }
      }
    }

    // The reader has to find these words on a screen afterwards. A
    // translated KPI sends somebody looking for something that is not
    // there.
    expect(broken, `translated away: ${broken.join(', ')}`).toEqual([])
  })

  it.each(TRANSLATED)('keeps every blank in $english', ({ code }) => {
    const wrong: string[] = []

    for (const [key, phrase] of Object.entries(HELP)) {
      const translated = phrase[code as 'ml']
      if (!translated) continue
      const a = placeholdersIn(phrase.en)
      const b = placeholdersIn(translated)
      if (a.join() !== b.join()) wrong.push(`${key}: [${a}] vs [${b}]`)
    }

    // A dropped {tmDays} is a rule with the number missing from it.
    expect(wrong, wrong.join(' · ')).toEqual([])
  })

  it('only offers languages that are actually finished', () => {
    for (const lang of LANGS) {
      if (lang.ready || lang.code === 'en') continue
      const done = Object.values(HELP).every(p => p[lang.code as 'ml'])
      expect(done, `${lang.english} is complete — mark it ready`).toBe(false)
    }
  })
})

describe('say', () => {
  it('fills the blanks', () => {
    expect(say({ en: 'within {n} days' }, 'en', { n: 3 })).toBe('within 3 days')
  })

  it('falls back to English rather than showing a key', () => {
    expect(say({ en: 'Only English' }, 'ml')).toBe('Only English')
  })

  it('leaves a blank it was given nothing for, rather than printing undefined', () => {
    expect(say({ en: 'on the {closingDay}' }, 'en', {})).toBe('on the {closingDay}')
  })
})
