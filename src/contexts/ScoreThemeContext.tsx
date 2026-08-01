import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { bandFor, type Band } from '@/lib/bands'

/**
 * Publishes a performance band as CSS custom properties on :root, so
 * interactive states — hover, active tab, focus ring — take the colour of
 * how someone is actually doing.
 *
 * Two layers, because they have different lifetimes:
 *
 *   base      the signed-in person's own year average. Set once by the
 *             shell and kept for the whole session, so every screen is
 *             tinted, not only the dashboard.
 *   override  a screen-scoped value, e.g. the team average on the team
 *             pages. Falls back to base when that screen unmounts.
 *
 * CSS variables rather than Tailwind classes because the value is only
 * known at runtime; Tailwind can only ship classes it saw at build time.
 */
interface ScoreTheme {
  band: Band | null
  score: number | null
  setBaseScore: (score: number | null) => void
  setOverride: (score: number | null) => void
}

const Ctx = createContext<ScoreTheme | undefined>(undefined)

/** Before any score exists, interactive states stay brand black. */
const NEUTRAL = { base: '#141519', soft: '#eeeef0', strong: '#000000' }

export function ScoreThemeProvider({ children }: { children: ReactNode }) {
  const [base, setBaseScore] = useState<number | null>(null)
  const [override, setOverride] = useState<number | null>(null)

  const score = override ?? base
  const band = useMemo(() => bandFor(score), [score])

  useEffect(() => {
    const c = band?.hex ?? NEUTRAL
    const root = document.documentElement
    root.style.setProperty('--score-accent', c.base)
    root.style.setProperty('--score-soft', c.soft)
    root.style.setProperty('--score-strong', c.strong)
  }, [band])

  return (
    <Ctx.Provider value={{ band, score, setBaseScore, setOverride }}>
      {children}
    </Ctx.Provider>
  )
}

export function useScoreTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useScoreTheme must be used inside <ScoreThemeProvider>')
  return ctx
}

/** The session-wide tint: the signed-in person's own average. */
export function useBaseScore(score: number | null | undefined) {
  const { setBaseScore } = useScoreTheme()
  useEffect(() => {
    if (score === null || score === undefined) return
    setBaseScore(score)
  }, [score, setBaseScore])
}

/**
 * Screen-scoped tint. A manager on the team pages sees the team average;
 * leaving the page falls back to their own.
 */
export function useAmbientScore(score: number | null | undefined) {
  const { setOverride } = useScoreTheme()
  useEffect(() => {
    if (score === null || score === undefined) return
    setOverride(score)
    return () => setOverride(null)
  }, [score, setOverride])
}
