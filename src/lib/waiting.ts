import { monthLabel } from './fy'

/**
 * Who is waiting for their manager's score, in any month of the year.
 *
 * Any month, because the tile that asked this used to read the month on
 * screen: it said 0 while the first row of the same list was a July
 * assessment still waiting, and nothing between the two said why.
 *
 * Counted in people, not months. Somebody with three months outstanding
 * is one person to get back to, and their row already names the three; a
 * count of 3 against one amber row sends a manager looking for two more
 * people who are not there.
 */
export function waitingForScore(
  subs: ReadonlyArray<{ employee_id: string; period_month: string; status: string }>,
  teamIds: ReadonlySet<string>,
): { people: number; months: string[] } {
  const people = new Set<string>()
  const months = new Set<string>()
  for (const s of subs) {
    if (s.status !== 'submitted' || !teamIds.has(s.employee_id)) continue
    people.add(s.employee_id)
    months.add(s.period_month)
  }
  // ISO month-starts, so sorting the strings is sorting the dates.
  return { people: people.size, months: [...months].sort() }
}

/**
 * The line under that count.
 *
 * The month when there is one, and the oldest when there are several,
 * because the oldest is the one somebody has been waiting longest on. When
 * nobody is waiting it says "all months": the tiles beside this one are a
 * single month each, and a bare 0 in a row of them reads as that month too.
 */
export function waitingCaption(months: readonly string[]): string {
  if (months.length === 0) return 'all months'
  if (months.length === 1) return monthLabel(months[0])
  return `oldest ${monthLabel(months[0])}`
}
