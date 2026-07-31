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
