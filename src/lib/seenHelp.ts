const KEY = 'cyrix.seenHelp'

/**
 * Has this person opened the manual yet?
 *
 * Read manualOffer() below before trusting this on its own. It answers
 * what a browser remembers, which is a smaller and less durable thing
 * than it looks: per origin, per device, gone when somebody clears their
 * history — and gone for the entire company the day the app moved to
 * app.cyrix.in.
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

/** Nothing, a line, or a panel. */
export type ManualOffer = 'none' | 'quiet' | 'loud'

/**
 * Whether to offer the manual on the dashboard, and how hard.
 *
 * This rule has been wrong twice, in opposite directions, so it lives
 * out here with tests on it.
 *
 * First it asked "have you been scored yet", which is a fine test for a
 * joiner and was wrong for a company that met the app all at once with a
 * year of history behind them — nobody was offered the page explaining
 * the thing they were all seeing for the first time.
 *
 * Then it asked "have you read it", which fixed that and broke something
 * worse. The answer to that question lives in localStorage, per origin
 * and per device, so moving to app.cyrix.in wiped it for everybody at
 * once and asked a person four months into their year, averaging 94,
 * whether they were new here.
 *
 * So the two questions are separated. Whether somebody is new is decided
 * by what the database knows and cannot be forgotten by a browser;
 * whether they have already taken the offer only ever hides it early,
 * for somebody who is new anyway. An established person is never asked,
 * whatever their browser has lost.
 *
 * Nobody loses the manual either way — the permanent link to it lives on
 * the profile page, which is where somebody goes when the question is
 * about themselves rather than about a number.
 */
export function manualOffer(opts: {
  /** Approved and in force. Anything else is still being set up. */
  kpiActive: boolean
  monthsScored: number
  hasRead: boolean
}): ManualOffer {
  // No working KPI: the screen behind this is empty and explains none of
  // itself. Loud, and not retired by having read it — somebody who
  // skimmed the manual before their KPI existed is exactly who needs it
  // again once it does.
  if (!opts.kpiActive) return 'loud'

  // Approved, nothing scored yet. Still worth offering, quietly, and
  // gone the moment they take it.
  if (opts.monthsScored === 0) return opts.hasRead ? 'none' : 'quiet'

  // A month behind them. They have been through this and do not need
  // asking again.
  return 'none'
}
