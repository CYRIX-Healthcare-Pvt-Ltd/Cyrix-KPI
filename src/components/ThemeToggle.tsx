import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Sun, Moon, MonitorSmartphone } from 'lucide-react'
import {
  type Theme, readTheme, setTheme, nextTheme, resolveTheme, THEME_KEY,
} from '@/lib/theme'

const LABEL: Record<Theme, string> = {
  light: 'Light — switch to dark',
  dark: 'Dark — follow the device',
  system: 'Following the device — switch to light',
}

/**
 * Light, dark, or follow the device.
 *
 * Three states rather than a two-way switch. "Follow the device" is the
 * default and where most people stay, and it is genuinely different from
 * light: it moves with the phone at sunset. A boolean would strand
 * everybody on whichever the app guessed first.
 *
 * The icon crossfades rather than swapping: the outgoing one rotates and
 * shrinks away while the incoming one arrives, so the control reads as one
 * thing changing state rather than two icons taking turns. Both sit in the
 * same grid cell, absolutely placed, which is what stops the button
 * flinching by a pixel as they exchange.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setLocal] = useState<Theme>(() => readTheme())

  // Another module in another tab may have changed it. Same origin, so the
  // choice arrives here as a storage event.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setLocal(readTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /**
   * Switches as a circular reveal spreading from the button, using the
   * View Transitions API. Where it is missing, or less motion was asked
   * for, the theme simply changes — the reveal is decoration.
   */
  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    const next = nextTheme(theme)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = (document as Document & {
      startViewTransition?: (cb: () => void) => void
    }).startViewTransition

    const commit = () => { setTheme(next); setLocal(next) }

    if (reduced || typeof start !== 'function') {
      commit()
      return
    }

    const x = event.clientX
    const y = event.clientY
    // The furthest corner, so the circle always finishes covering the
    // screen whichever corner the button is sitting in.
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )
    const root = document.documentElement
    root.style.setProperty('--theme-x', `${x}px`)
    root.style.setProperty('--theme-y', `${y}px`)
    root.style.setProperty('--theme-r', `${radius}px`)

    // flushSync is required: startViewTransition snapshots the DOM when
    // its callback returns, and a normal React update would not have
    // landed by then — the snapshot would be of the old theme twice.
    start.call(document, () => { flushSync(commit) })
  }

  const shown = resolveTheme(theme)
  const following = theme === 'system'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={LABEL[theme]}
      title={LABEL[theme]}
      className={`btn-press relative grid h-9 w-9 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 ${className}`}
    >
      <Sun
        className={`absolute h-5 w-5 text-amber-500 transition-all duration-[var(--dur-ui)] ${
          shown === 'light' && !following ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'
        }`}
      />
      <Moon
        className={`absolute h-5 w-5 text-indigo-400 transition-all duration-[var(--dur-ui)] ${
          shown === 'dark' && !following ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
        }`}
      />
      {/* The third state says so rather than showing whichever the device
          happens to be right now, which would read as an explicit choice
          somebody had made. */}
      <MonitorSmartphone
        className={`absolute h-5 w-5 transition-all duration-[var(--dur-ui)] ${
          following ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0'
        }`}
      />
    </button>
  )
}
