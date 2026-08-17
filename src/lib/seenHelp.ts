const KEY = 'cyrix.seenHelp'

/**
 * Has this person opened the manual yet?
 *
 * The dashboard used to offer it only to people with no scores yet, on
 * the reasoning that "have you been scored" is a better test of newness
 * than asking. That was right for a joiner and wrong for everybody who
 * was already here the day the app arrived — the whole company saw the
 * site for the first time with a year of scores behind them, and none of
 * them were offered the page explaining it.
 *
 * So the test is whether they have read it, not whether they are new.
 *
 * Keyed by employee, not just by device. A service floor shares phones
 * and a manager signs into their own account on somebody else's handset
 * to look at a score; storing one flag per browser meant the first
 * person to open the manual retired the card for every account used on
 * that device afterwards, including the joiner it was written for.
 *
 * Still local rather than on the server: it costs a round trip to store
 * remotely, and the worst case of getting it wrong is one extra card.
 */
const keyFor = (employeeId: string | undefined) =>
  employeeId ? `${KEY}.${employeeId}` : KEY

export const hasSeenHelp = (employeeId: string | undefined): boolean => {
  try {
    return localStorage.getItem(keyFor(employeeId)) === '1'
  } catch {
    // Private browsing. Showing the card again is the harmless answer.
    return false
  }
}

export const markHelpSeen = (employeeId: string | undefined): void => {
  try { localStorage.setItem(keyFor(employeeId), '1') } catch { /* see above */ }
}
