import { useEffect, useRef } from 'react'

/**
 * A form that a button opens underneath itself, at the foot of a page,
 * opens below the screen: the person pressed the button and nothing seems
 * to have happened until they scroll (reported 1 Oct, on Send back).
 *
 * Give the form this ref. When `open` turns true it is brought into view —
 * "nearest", so a screen that already shows all of it does not move — and
 * the cursor is put in its first field. The focus is told not to scroll:
 * the browser's own jump for a focused field stops with the field on the
 * edge of the screen and the button under it still cut off.
 *
 * Below lg the tab bar covers the foot of the screen, so the form needs
 * room under it: put `scroll-mb-24 lg:scroll-mb-6` on the same element.
 */
export function useReveal<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    el.querySelector<HTMLElement>('textarea, input, select')?.focus({ preventScroll: true })
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  }, [open])
  return ref
}
