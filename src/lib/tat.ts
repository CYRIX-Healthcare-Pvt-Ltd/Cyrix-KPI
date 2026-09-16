/**
 * How long something has been waiting on somebody.
 *
 * Every admin queue in this app is a person on the other end of it: a
 * leaver who is still on the payroll screen, somebody locked out who
 * cannot ask anywhere else, a month filed by mistake. The screens said
 * when each one arrived and left the arithmetic to whoever was reading,
 * which is the one thing a queue should never do — "11 Sep" is not a
 * number anybody compares, and "waiting 5 days" is.
 *
 * The same figure drives the reminder mail, so what an admin reads on
 * screen and what the reminder says are the same sentence.
 */

/** A day, in milliseconds. Whole days is what anybody chasing this says. */
const DAY = 86_400_000
const HOUR = 3_600_000

/** Whole days waited. Never negative: a clock skewed forward is not -1. */
export function daysWaiting(since: string | Date, now: number = Date.now()): number {
  const t = since instanceof Date ? since.getTime() : Date.parse(since)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / DAY))
}

export type WaitTone = 'ok' | 'warn' | 'late'

/**
 * The wait, as a phrase and a severity.
 *
 * A day is the line. Under it, this is simply a queue being a queue;
 * over it, somebody has been waiting since yesterday and the reminder
 * mail will say so tonight. Two days and it reads as late, because by
 * then nobody is going to be pleased about it.
 */
export function waitingLabel(
  since: string | Date, now: number = Date.now(),
): { text: string; tone: WaitTone; days: number } {
  const t = since instanceof Date ? since.getTime() : Date.parse(since)
  if (!Number.isFinite(t)) return { text: '', tone: 'ok', days: 0 }

  const ms = Math.max(0, now - t)
  const days = Math.floor(ms / DAY)

  if (days >= 1) {
    return {
      days,
      tone: days >= 2 ? 'late' : 'warn',
      text: `Waiting ${days} day${days === 1 ? '' : 's'}`,
    }
  }

  const hours = Math.floor(ms / HOUR)
  return {
    days: 0,
    tone: 'ok',
    text: hours < 1 ? 'Waiting under an hour' : `Waiting ${hours} hour${hours === 1 ? '' : 's'}`,
  }
}

/**
 * What it took, once it is done.
 *
 * Said in the same units as the wait, so a queue read top to bottom does
 * not change vocabulary halfway down. Same day is "same day" rather than
 * "0 days", which reads as a bug.
 */
export function turnaroundLabel(
  from: string | Date, to: string | Date | null | undefined,
): string {
  const a = from instanceof Date ? from.getTime() : Date.parse(from)
  const b = to == null ? NaN : to instanceof Date ? to.getTime() : Date.parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  const ms = Math.max(0, b - a)
  const days = Math.floor(ms / DAY)
  if (days >= 1) return `Answered in ${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(ms / HOUR)
  return hours < 1 ? 'Answered the same hour' : `Answered in ${hours} hour${hours === 1 ? '' : 's'}`
}
