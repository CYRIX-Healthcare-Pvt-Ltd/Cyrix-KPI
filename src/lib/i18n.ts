import { useCallback, useEffect, useState } from 'react'

/**
 * Translation, for the one page that needs it.
 *
 * The manual is the only screen written to be *read* rather than
 * operated — everything else is labels beside numbers, and a service
 * engineer who knows the app knows what "Submit" does whatever language
 * the sentence around it is in. So this is deliberately small: a
 * dictionary and a switch, not a framework.
 *
 * The rule that matters: anything the software itself says stays in
 * English. Somebody reading "നിങ്ങളുടെ KPI" then has to find the word
 * KPI on a screen, and a translated KPI would send them looking for
 * something that is not there. The list is enforced by a test rather
 * than by remembering — see i18n.test.ts.
 */

export type Lang = 'en' | 'ml' | 'hi' | 'te'

/**
 * `ready` is whether the manual is actually translated into it.
 *
 * A language nobody has finished is not offered. Picking हिन्दी and
 * getting a page of English reads as a broken app, where not seeing the
 * option reads as a language that has not been added yet — which is the
 * truth. The test refuses to let a language be marked ready with any
 * string missing.
 */
export const LANGS: Array<{
  code: Lang; label: string; english: string; ready: boolean
}> = [
  { code: 'en', label: 'English',   english: 'English',   ready: true },
  { code: 'ml', label: 'മലയാളം',    english: 'Malayalam', ready: true },
  { code: 'hi', label: 'हिन्दी',      english: 'Hindi',     ready: true },
  { code: 'te', label: 'తెలుగు',      english: 'Telugu',    ready: true },
]

export const READY_LANGS = LANGS.filter(l => l.ready)

/**
 * Words that must survive translation untouched.
 *
 * Two kinds, and both for the same reason — the reader has to find them
 * on a screen afterwards:
 *
 *   Names of things the system counts (KPI, KRA, ESMS, the two bands).
 *   Words printed on buttons and status chips (Final, Under review).
 *
 * Not an exhaustive glossary. It is the list a mistranslation would
 * actually cost somebody time over, which is why it is short enough to
 * stay true.
 */
export const KEEP_ENGLISH = [
  'KPI', 'KRA', 'ESMS', 'HR', 'SW Admin', 'Cyrix', 'Excel',
  'Job Role', 'Core Values',
  'Final', 'Under review', 'Manager reviewed',
  'Team analysis', 'Bell curve', 'My Team', 'My KPI',
  'Poor', 'Satisfactory', 'Good', 'Very Good', 'Excellent',
] as const

const STORAGE_KEY = 'cyrix.helpLang'

const isLang = (v: unknown): v is Lang =>
  typeof v === 'string' && READY_LANGS.some(l => l.code === v)

/**
 * Remembered per device, not per account.
 *
 * Somebody who reads Malayalam reads it on their own phone every time,
 * and storing it on the server would mean a round trip before the page
 * can render a single word of it.
 */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return isLang(saved) ? saved : 'en'
    } catch {
      // Private browsing, or storage disabled. English and carry on —
      // a manual that throws is worse than a manual in the wrong
      // language.
      return 'en'
    }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* see above */ }
  }, [lang])

  const setLang = useCallback((l: Lang) => setLangState(l), [])
  return [lang, setLang]
}

/** English is the source and is never optional; the rest arrive later. */
export type Phrase =
  { en: string } & Partial<Record<Exclude<Lang, 'en'>, string>>

/**
 * One string, in one language, with its blanks filled.
 *
 * Falls back to English rather than to the key. A missing translation
 * should read as an untranslated sentence, not as `m2.p3.how` — the
 * reader cannot act on a key, and the test already fails the build for
 * gaps, so this only ever fires in development.
 */
export function say(
  phrase: Phrase | undefined,
  lang: Lang,
  vars?: Record<string, string | number>,
): string {
  if (!phrase) return ''
  const raw = phrase[lang] || phrase.en
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole)
}

/** The blanks a string expects, for the test that checks they match. */
export const placeholdersIn = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
