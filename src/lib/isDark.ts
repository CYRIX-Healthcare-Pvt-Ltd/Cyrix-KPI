import { useEffect, useState } from 'react'

/**
 * Which way up the palette currently is.
 *
 * Read from the DOM rather than from React state, because the theme lives
 * on the root element and is written by a plain module — there is no
 * provider above everything to ask. Three states, not two: an explicit
 * choice stamps `data-theme`, and the default "system" stamps nothing,
 * which is most people.
 */
export const isDark = () =>
  typeof document !== 'undefined'
  && (document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme
      && window.matchMedia?.('(prefers-color-scheme: dark)').matches))

/**
 * The same answer, as a hook that re-renders when it changes.
 *
 * For the handful of places a colour cannot come from CSS. Charts are the
 * whole reason this exists: Recharts writes its colours as SVG
 * presentation attributes, and those do not accept `var()` — so a series
 * drawn in near-black stays near-black on a near-black page however the
 * stylesheet is written.
 *
 * Prefer a CSS variable everywhere it is possible. This costs a re-render
 * of whatever uses it on every theme change; a token costs nothing.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(isDark)

  useEffect(() => {
    const sync = () => setDark(isDark())
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', sync)
    // The switch writes data-theme on the root; nothing else does.
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mq?.removeEventListener?.('change', sync); obs.disconnect() }
  }, [])

  return dark
}
