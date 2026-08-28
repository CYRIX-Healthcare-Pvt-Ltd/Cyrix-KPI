import {
  createContext, useContext, useEffect, useMemo, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import { bandFor, type Band } from '@/lib/bands'
import { isDark } from '@/lib/isDark'

/**
 * Publishes a performance band as CSS custom properties, so interactive
 * states — hover, active tab, focus ring — take the colour of how
 * someone is actually doing.
 *
 * Two layers, because they mean different things and belong in different
 * places:
 *
 *   base      the signed-in person's own year average. Written to :root
 *             by the shell and kept for the whole session, so every
 *             screen is tinted, not only the dashboard.
 *   override  what the screen in front of you is reporting on, e.g. the
 *             team average. Scoped to the page container.
 *
 * That scoping is the whole point of the split. Both used to be written
 * to :root, which meant a manager on the team pages had her nav go green
 * because her team was doing well — including tabs that have nothing to
 * do with the team, which lit up green on hover. The chrome is you; the
 * content is whatever you are looking at. Leave the page and the colour
 * leaves with it, without anything having to be unset.
 *
 * CSS variables rather than Tailwind classes because the value is only
 * known at runtime; Tailwind can only ship classes it saw at build time.
 */
interface ScoreTheme {
  /** The effective band — the override where there is one, else base. */
  band: Band | null
  score: number | null
  /**
   * Custom properties for the override, to be spread onto the element
   * that wraps the page. Empty when the screen has nothing of its own to
   * say, so the page simply inherits :root.
   */
  scopeStyle: CSSProperties
  setBaseScore: (score: number | null) => void
  setOverride: (score: number | null) => void
}

const Ctx = createContext<ScoreTheme | undefined>(undefined)

/** Before any score exists, interactive states stay brand black. */
const NEUTRAL = { base: '#141519', soft: '#eeeef0', strong: '#000000' }

/** In dark, the same place the neutral goes: near-white rather than black. */
const NEUTRAL_DARK = { base: '#f4f5f7', soft: '#262830', strong: '#ffffff' }

/**
 * Whether the page is currently dark.
 *
 * Read from the DOM rather than from React state because the theme lives
 * on the root element and is written by a plain module — there is no
 * provider above this one to ask.
 */
/* Imported rather than restated. Two copies of "is it dark" is how one of
   them ends up handling the unstamped "system" case and the other not. */


/**
 * The band's three tokens, turned the right way up for the current theme.
 *
 * Every band hex was chosen for a white page: `soft` is a pale wash to sit
 * behind text and `strong` is a near-black version of the hue to sit on it.
 * On a dark page that pairing is exactly backwards — and where the token is
 * used as bare text with no wash behind it, as the bottom navigation does
 * for the tab you are standing on, `strong` is dark ink on a dark page and
 * simply disappears.
 *
 * So in dark the two swap roles: `base` is the mid-tone of the hue and
 * reads on either ground, which is what text becomes, and the wash is a
 * dark tint of it rather than a pale one. The hue is unchanged — a green
 * band stays green, which is the whole point of the tinting.
 */
function tokensFor(band: Band | null) {
  const dark = isDark()
  if (!band) return dark ? NEUTRAL_DARK : NEUTRAL
  const c = band.hex
  return dark
    ? {
        base: c.base,
        soft: `color-mix(in srgb, ${c.base} 22%, #0d0e12)`,
        strong: c.base,
      }
    : c
}

const varsFor = (band: Band | null): CSSProperties => {
  const c = tokensFor(band)
  return {
    '--score-accent': c.base,
    '--score-soft': c.soft,
    '--score-strong': c.strong,
  } as CSSProperties
}

export function ScoreThemeProvider({ children }: { children: ReactNode }) {
  const [base, setBaseScore] = useState<number | null>(null)
  const [override, setOverride] = useState<number | null>(null)

  /*
   * Bumped whenever the theme changes, so the two effects below recompute.
   * Without it the tint keeps whichever way up it was written at load and
   * the whole palette inverts behind the reader's back.
   */
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => {
    const bump = () => setThemeTick(t => t + 1)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', bump)
    // The switch writes data-theme on the root; nothing else does.
    const obs = new MutationObserver(bump)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mq?.removeEventListener?.('change', bump); obs.disconnect() }
  }, [])

  const baseBand = useMemo(() => bandFor(base), [base])
  const score = override ?? base
  const band = useMemo(() => bandFor(score), [score])

  // Only ever the signed-in person's own. The document is the chrome.
  useEffect(() => {
    const c = tokensFor(baseBand)
    const root = document.documentElement
    root.style.setProperty('--score-accent', c.base)
    root.style.setProperty('--score-soft', c.soft)
    root.style.setProperty('--score-strong', c.strong)
  }, [baseBand, themeTick])

  /**
   * The colour of the screen you are on, published separately.
   *
   * One piece of chrome is not about you: the tab you are standing on,
   * which is a label for the page below it. It reads --page-*, so it can
   * go green on My Team while every other tab still hovers in your own
   * band. Two names rather than one scope, because the active tab and
   * the tab beside it are siblings — there is no element to put a scope
   * on that contains one and not the other.
   *
   * Identical to --score-* wherever the screen has nothing of its own to
   * report, which is most of them.
   */
  useEffect(() => {
    const c = tokensFor(band)
    const root = document.documentElement
    root.style.setProperty('--page-accent', c.base)
    root.style.setProperty('--page-soft', c.soft)
    root.style.setProperty('--page-strong', c.strong)
  }, [band, themeTick])

  const scopeStyle = useMemo(
    () => (override === null ? {} : varsFor(bandFor(override))),
    [override],
  )

  return (
    <Ctx.Provider
      value={{ band, score, scopeStyle, setBaseScore, setOverride }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useScoreTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useScoreTheme must be used inside <ScoreThemeProvider>')
  return ctx
}

/**
 * The session-wide tint: the signed-in person's own average.
 *
 * `subject` is whose score this is, and `loaded` says the answer has
 * actually arrived. Both matter, because "no score" and "no score yet"
 * are different states and this hook used to conflate them — it ignored
 * null entirely, so the previous value simply stayed. Someone who had
 * not started their KPI inherited the colour of whoever was signed in
 * before them, and a green interface said they were doing well.
 */
export function useBaseScore(
  subject: string | undefined,
  score: number | null | undefined,
  loaded: boolean,
) {
  const { setBaseScore } = useScoreTheme()

  // Back to neutral the moment the subject changes, rather than holding
  // the last person's colour until the new figure lands.
  useEffect(() => { setBaseScore(null) }, [subject, setBaseScore])

  useEffect(() => {
    if (!loaded) return
    setBaseScore(score ?? null)
  }, [score, loaded, setBaseScore])
}

/**
 * Screen-scoped tint. A manager on the team pages sees the team average
 * inside the page; leaving it falls back to their own.
 *
 * Applies to the page container only, never the nav — see scopeStyle.
 *
 * Unlike the base tint this keeps ignoring null, because null here means
 * the screen has nothing of its own to say — and falling through to the
 * reader's own band is the right answer, not neutral.
 */
export function useAmbientScore(score: number | null | undefined) {
  const { setOverride } = useScoreTheme()
  useEffect(() => {
    if (score === null || score === undefined) return
    setOverride(score)
    return () => setOverride(null)
  }, [score, setOverride])
}
