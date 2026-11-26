/**
 * The last day to submit a month and the last day to score it (0153).
 *
 * Day N of the following month, to the end of that day in India: with a
 * team member's day of 12, September is entered until the end of 12
 * October and from the 13th it is scored 0. The manager's day works the
 * same way. Mirrors kpi_deadline_at() in the database, which is what
 * actually refuses a late submit; this is what the screens say.
 */
import type { TatPolicy } from '@/lib/queries'

export type Side = 'tm' | 'manager'

const IST_MINUTES = 330

/**
 * Day N of the month after `period`, as a UTC date at midnight. Null where no last day applies.
 * `reopen` is the month's own "open until" from an approved request (0273): the instant
 * after its last day in India, so its last day is the day before that, if it is later.
 */
function lastDayUtc(period: string, side: Side, p: TatPolicy | undefined, reopen?: string | null): Date | null {
  if (!p?.deadlines_from || period < p.deadlines_from) return null
  if (side === 'tm' ? p.no_tm : p.no_mgr) return null  // in the list with no last days (0293)
  const day = Math.max(1, Math.min(28, side === 'manager' ? p.manager_grace_days : p.tm_grace_days))
  const [y, m] = period.split('-').map(Number)
  const base = Date.UTC(y, m, day)
  if (!reopen) return new Date(base)
  const ist = new Date(new Date(reopen).getTime() + IST_MINUTES * 60_000)
  const own = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 86_400_000
  return new Date(Math.max(base, own))
}

/** The instant the last day is over. */
export function lastDayEnds(period: string, side: Side, p: TatPolicy | undefined, reopen?: string | null): Date | null {
  const d = lastDayUtc(period, side, p, reopen)
  return d ? new Date(d.getTime() + (24 * 60 - IST_MINUTES) * 60_000) : null
}

/** "12 Oct". */
export function lastDayLabel(period: string, side: Side, p: TatPolicy | undefined, reopen?: string | null): string | null {
  const d = lastDayUtc(period, side, p, reopen)
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null
}

export function isPastLastDay(period: string, side: Side, p: TatPolicy | undefined, now = new Date(), reopen?: string | null): boolean {
  const end = lastDayEnds(period, side, p, reopen)
  return !!end && now >= end
}

/** Whole days from today (in India) to the last day: 0 on the day itself, null when there is none or it has passed. */
export function daysLeft(period: string, side: Side, p: TatPolicy | undefined, now = new Date()): number | null {
  const d = lastDayUtc(period, side, p)
  if (!d || isPastLastDay(period, side, p, now)) return null
  const ist = new Date(now.getTime() + IST_MINUTES * 60_000)
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  return Math.round((d.getTime() - today) / 86_400_000)
}

/** "1 day 12 hr 32 min left to submit"; under a day, "5 hr 12 min 33 sec left to score". */
export function timeLeftText(ms: number, side: Side): string {
  const verb = side === 'manager' ? 'score' : 'submit'
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86_400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60
  const parts = d > 0
    ? [`${d} day${d === 1 ? '' : 's'}`, `${h} hr`, `${m} min`]
    : [`${h} hr`, `${m} min`, `${s % 60} sec`]
  return `${parts.join(' ')} left to ${verb}`
}
