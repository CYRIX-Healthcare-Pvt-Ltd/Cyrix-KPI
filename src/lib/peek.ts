/**
 * Cyra leaning out to say she has something.
 *
 * The button already carries a red count and a pulsing ring, and people
 * still walk past it: a badge on an icon is only seen by somebody
 * already looking at that corner of the screen. So once a day, and only
 * when something is genuinely waiting, the panel puts a sentence on the
 * screen instead — the one thing a badge cannot do.
 *
 * Once a day is the whole design. A bubble on every page view is an
 * advert, and people learn to close adverts without reading them; a
 * bubble that appears when there is nothing to say is a lie. So it needs
 * both: something to say, and not already said today.
 *
 * "Something to say" is not only outstanding work. Somebody who has
 * filed every month and manages nobody has nothing waiting and never saw
 * the bubble at all -- which is exactly the person who never discovered
 * the panel, and Cyra still has their position and a thing they did not
 * know about to show them. Work makes it urgent; news makes it worth
 * opening. Both get a bubble, and the wording says which it is.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Today, by the reader's own clock.
 *
 * Local rather than UTC on purpose: at half past six in the morning in
 * India, toISOString() still says yesterday, so a UTC key would let the
 * bubble show twice on the same working day for the early shift.
 */
export const dayKey = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export interface PeekInput {
  /** How many things are waiting on this person. */
  things: number
  /** Cyra has a position or a fact for them, even with nothing waiting. */
  news?: boolean
  /** The day it last leaned out, as stored. Null when never. */
  lastShown: string | null
  /** Shared logins have nobody to greet. */
  systemAccount?: boolean
  /** Nothing to announce while the panel is already open. */
  panelOpen?: boolean
  now?: Date
}

export function shouldPeek(opts: PeekInput): boolean {
  if (opts.systemAccount || opts.panelOpen) return false
  if (opts.things <= 0 && !opts.news) return false
  return opts.lastShown !== dayKey(opts.now ?? new Date())
}
