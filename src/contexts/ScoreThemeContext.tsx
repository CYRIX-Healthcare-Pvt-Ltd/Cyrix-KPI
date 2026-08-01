import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { bandFor, type Band } from '@/lib/bands'

/**
 * Publishes the signed-in person's own performance band as CSS custom
 * properties on :root, so interactive states — hover, active tab, focus
 * ring — take the colour of how they are actually doing.
 *
 * Managers viewing their team get the team average instead, set by the
 * team screens via `setScore`. It resets on unmount so the manager's own
 * band returns when they navigate away.
 *
 * Done with CSS variables rather than Tailwind classes because the value
 * changes at runtime; Tailwind can only ship classes it saw at build.
 */
interface ScoreTheme {
  band: Band | null
  score: number | null
  /** Override the ambient band, e.g. with a team average. */
  setScore: (score: number | null) => void
}

const Ctx = createContext<ScoreTheme | undefined>(undefined)

/** Hex per band, kept here because CSS variables need literal values. */
const HEX: Record<string, { base: string; soft: string; strong: string }> = {
  excellent:    { base: '#10b981', soft: '#d1fae5', strong: '#047857' },
  veryGood:     { base: '#84cc16', soft: '#ecfccb', strong: '#4d7c0f' },
  good:         { base: '#f59e0b', soft: '#fef3c7', strong: '#b45309' },
  satisfactory: { base: '#f97316', soft: '#ffedd5', strong: '#c2410c' },
  poor:         { base: '#e30613', soft: '#fde3e5', strong: '#9e0812' },
}

/** Before any score exists, interactive states stay brand black. */
const NEUTRAL = { base: '#141519', soft: '#eeeef0', strong: '#000000' }

export function ScoreThemeProvider({ children }: { children: ReactNode }) {
  const [score, setScore] = useState<number | null>(null)
  const band = useMemo(() => bandFor(score), [score])

  useEffect(() => {
    const c = band ? HEX[band.key] ?? NEUTRAL : NEUTRAL
    const root = document.documentElement
    root.style.setProperty('--score-accent', c.base)
    root.style.setProperty('--score-soft', c.soft)
    root.style.setProperty('--score-strong', c.strong)
  }, [band])

  return (
    <Ctx.Provider value={{ band, score, setScore }}>{children}</Ctx.Provider>
  )
}

export function useScoreTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useScoreTheme must be used inside <ScoreThemeProvider>')
  return ctx
}

/**
 * Sets the ambient band for as long as the calling screen is mounted.
 * A manager on the team pages tints to the team average; leaving the
 * page restores whatever was there before.
 */
export function useAmbientScore(score: number | null | undefined) {
  const { setScore } = useScoreTheme()
  useEffect(() => {
    if (score === null || score === undefined) return
    setScore(score)
    return () => setScore(null)
  }, [score, setScore])
}
