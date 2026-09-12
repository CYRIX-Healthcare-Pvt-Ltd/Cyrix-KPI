/**
 * Cyra leaning out to say she has something.
 *
 * The button already carries a red count and a pulsing ring, and people
 * still walk past it: a badge on an icon is only seen by somebody
 * already looking at that corner of the screen. So once a day, and only
 * when something is genuinely waiting, the panel puts a sentence on the
 * screen instead — the one thing a badge cannot do.
 *
 * Unread is the rule, not the calendar.
 *
 * It was once a day first, and once a day is wrong in both directions: a
 * person who never opens the panel gets nothing further that day however
 * much arrives, and two people sharing a phone share the day between
 * them -- the second one to sign in was told nothing at all, because the
 * first one's bubble had used the day up.
 *
 * So it leans out while there is something unread, and stops the moment
 * the panel is opened, because opening it is reading it. That cannot
 * nag: the only way to keep seeing it is to keep not looking.
 *
 * The × is the other limit. Somebody who has decided against it should
 * not be asked again on the next screen, so a dismissal stands for the
 * rest of that day, on that person's own key.
 *
 * "Something" is not only outstanding work. Somebody who files every
 * month and manages nobody has nothing waiting and saw no bubble at all
 * -- which is exactly the person who never found the panel, and Cyra
 * still has their position and something they did not know to show them.
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
  /** Everything Cyra has for them: the work, and today's news. */
  waiting: number
  /** Any of it new since they last opened the panel. */
  unread: boolean
  /** The day they last put the bubble away, as stored. Null when never. */
  dismissed: string | null
  /** Shared logins have nobody to greet. */
  systemAccount?: boolean
  /** Nothing to announce while the panel is already open. */
  panelOpen?: boolean
  now?: Date
}

export function shouldPeek(opts: PeekInput): boolean {
  if (opts.systemAccount || opts.panelOpen) return false
  if (opts.waiting <= 0 || !opts.unread) return false
  return opts.dismissed !== dayKey(opts.now ?? new Date())
}
