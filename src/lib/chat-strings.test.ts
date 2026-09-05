import { describe, it, expect } from 'vitest'
import { READY_LANGS, KEEP_ENGLISH, say, placeholdersIn, type Lang } from './i18n'
import { CHAT } from './chat-strings'

/**
 * The same guarantees the manual has, for the sentences Cyra speaks.
 *
 * These went untested while the manual next door had five suites over
 * it, and the difference showed: a phrase could be added in English
 * alone, or translated with a {remaining} quietly dropped, and nothing
 * would say so until somebody reading Malayalam met an English
 * paragraph.
 *
 * It matters more since the panel started re-rendering the whole
 * conversation on a language switch. Before, a gap showed up in one new
 * bubble; now it shows up in every bubble at once.
 */

const TRANSLATED = READY_LANGS.filter(l => l.code !== 'en')

/** Word-start match, so "KRAs" still counts as KRA. Mirrors i18n.test.ts. */
const uses = (text: string, term: string) =>
  new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)

describe('what Cyra says', () => {
  it('has English for every phrase', () => {
    for (const [key, phrase] of Object.entries(CHAT)) {
      expect(phrase.en, `${key} has no English`).toBeTruthy()
    }
  })

  it.each(TRANSLATED)('is complete in $english', ({ code }) => {
    const missing = Object.entries(CHAT)
      .filter(([, phrase]) => !phrase[code as 'ml'])
      .map(([key]) => key)

    // A language is only offered once it is finished. A gap here is a
    // bubble that comes out in English in the middle of a Malayalam
    // conversation.
    expect(missing, `${missing.length} phrase(s) missing`).toEqual([])
  })

  it.each(TRANSLATED)('keeps every blank in $english', ({ code }) => {
    const wrong: string[] = []

    for (const [key, phrase] of Object.entries(CHAT)) {
      const translated = phrase[code as 'ml']
      if (!translated) continue
      const a = placeholdersIn(phrase.en)
      const b = placeholdersIn(translated)
      if (a.join() !== b.join()) wrong.push(`${key}: [${a}] vs [${b}]`)
    }

    // A dropped {remaining} is not a simpler sentence, it is a different
    // one that says less — which is exactly the risk when these get
    // rewritten for plainer English.
    expect(wrong, wrong.join(' · ')).toEqual([])
  })

  it.each(TRANSLATED)('keeps the software\'s own words in English in $english', ({ code }) => {
    const broken: string[] = []

    for (const [key, phrase] of Object.entries(CHAT)) {
      const translated = phrase[code as 'ml']
      if (!translated) continue
      for (const term of KEEP_ENGLISH) {
        if (uses(phrase.en, term) && !uses(translated, term)) {
          broken.push(`${key}: "${term}"`)
        }
      }
    }

    // KRA and KPI are printed on the screens these sentences send people
    // to. Translating them sends somebody looking for a word that is not
    // there.
    expect(broken, `translated away: ${broken.join(', ')}`).toEqual([])
  })

  /**
   * The mechanism the language switch actually rides on.
   *
   * ChatBot stores a turn as a key plus its numbers and renders it when
   * it is drawn, so switching language re-renders the scrollback. That
   * only works if every phrase resolves in every language and fills all
   * of its blanks — which is what this checks, one language at a time,
   * over every phrase the panel can produce.
   */
  it.each(READY_LANGS)('renders every phrase in $english with nothing left blank', ({ code }) => {
    // A value for every blank any phrase in the table asks for.
    const vars: Record<string, string | number> = {}
    for (const phrase of Object.values(CHAT)) {
      for (const hole of placeholdersIn(phrase.en)) vars[hole] = 'X'
    }

    const unfilled: string[] = []
    for (const key of Object.keys(CHAT)) {
      const out = say(CHAT[key], code as Lang, vars)
      if (!out.trim()) unfilled.push(`${key}: empty`)
      // A brace that survives is a placeholder the translation invented.
      if (/\{\w+\}/.test(out)) unfilled.push(`${key}: ${out.match(/\{\w+\}/)![0]}`)
    }
    expect(unfilled, unfilled.join(' · ')).toEqual([])
  })

  it('actually translates, rather than copying the English through', () => {
    // Some phrases are only blanks and punctuation — "{name} ({ecode}):
    // {score} — {band}." is the same line in every language because
    // there is no English in it to translate. Identical is correct
    // there, and only there.
    const hasWords = (s: string) => /[a-z]/i.test(s.replace(/\{\w+\}/g, ''))

    const copied = Object.entries(CHAT)
      .filter(([, p]) => p.ml && p.ml === p.en && hasWords(p.en))
      .map(([key]) => key)

    // A phrase left in English in the Malayalam column passes every
    // check above and still reads as a missing translation.
    expect(copied, copied.join(', ')).toEqual([])
  })
})
