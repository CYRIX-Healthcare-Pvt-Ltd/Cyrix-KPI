/**
 * Financial year helpers. Cyrix runs April → March, so FY 2026-27 covers
 * Apr-26 … Mar-27 exactly as the template's month columns do.
 */

export const MONTH_LABELS = [
  'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
  'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
] as const

/** '2026-04-01' → 'Apr-26' */
export function monthLabel(isoDate: string): string {
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00' : ''))
  const mon = d.toLocaleString('en-US', { month: 'short' })
  return `${mon}-${String(d.getFullYear()).slice(2)}`
}

/** Date → '2026-04-01' (first of that month, no timezone drift). */
export function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Which FY does this date fall in? April rolls the year over. */
export function fyForDate(d: Date): string {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** The twelve month-start dates of a financial year, Apr → Mar. */
export function fyMonths(fyCode: string): string[] {
  const startYear = Number(fyCode.split('-')[0])
  return Array.from({ length: 12 }, (_, i) => {
    const monthIndex = 3 + i // 3 = April
    const year = startYear + Math.floor(monthIndex / 12)
    const month = (monthIndex % 12) + 1
    return `${year}-${String(month).padStart(2, '0')}-01`
  })
}

/**
 * The month people are actually reporting on right now — the previous
 * one. You submit April's KPI during May.
 */
export function currentReportingMonth(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  return monthStart(d)
}

/** Is this month inside the given FY? */
export function isMonthInFy(monthIso: string, fyCode: string): boolean {
  return fyMonths(fyCode).includes(monthIso)
}

/**
 * A month can only be assessed once it has finished, so the current month
 * and everything after it are closed. Used to gate the pickers, the
 * submission screen and the Excel export alike — otherwise someone could
 * score a month that has not happened.
 */
export function isMonthOpen(monthIso: string, today = new Date()): boolean {
  return monthIso <= currentReportingMonth(today)
}

/** The months of a financial year that are actually assessable today. */
export function openFyMonths(fyCode: string, today = new Date()): string[] {
  return fyMonths(fyCode).filter(m => isMonthOpen(m, today))
}

/**
 * The months a particular KPI covers.
 *
 * Somebody who joined in June owes nothing for April and May, and listing
 * those months put two permanent blanks on their record and two people on
 * their manager's chase list. `startsFrom` is null until somebody says —
 * see migration 0043 — and null means the whole year, which is what the
 * app did before the question was asked.
 *
 * Dates are ISO month-starts throughout, so a string compare is a date
 * compare and there is no timezone to get wrong.
 */
export function fyMonthsFrom(
  fyCode: string,
  startsFrom: string | null | undefined,
): string[] {
  const months = fyMonths(fyCode)
  if (!startsFrom) return months
  return months.filter(m => m >= startsFrom)
}

/**
 * The month to offer first when asking where a KPI starts.
 *
 * Somebody who joined mid-year almost always means the month they
 * joined, and the system already knows it — so the question arrives with
 * the likely answer in it rather than as an empty box. Anyone who joined
 * before this year gets April, which is the whole year.
 */
export function defaultStartMonth(
  fyCode: string,
  dateOfJoining?: string | null,
): string {
  const months = fyMonths(fyCode)
  if (!dateOfJoining) return months[0]
  // Sliced, not parsed: new Date('2026-06-01') is midnight UTC, which is
  // 31 May in Asia/Kolkata and would offer the wrong month.
  const joined = `${dateOfJoining.slice(0, 7)}-01`
  return months.includes(joined) ? joined : months[0]
}

/** Assessable today, and inside this KPI's own window. */
export function openFyMonthsFrom(
  fyCode: string,
  startsFrom: string | null | undefined,
  today = new Date(),
): string[] {
  return fyMonthsFrom(fyCode, startsFrom).filter(m => isMonthOpen(m, today))
}
