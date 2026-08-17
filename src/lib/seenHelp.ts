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
 * The card goes away the moment they open the manual once, and stays
 * until they do.
 *
 * Per device rather than per account, like the language choice: it costs
 * a round trip to store on the server and the worst case of getting it
 * wrong is one extra card on one extra phone.
 */
export const hasSeenHelp = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Private browsing. Showing the card again is the harmless answer.
    return false
  }
}

export const markHelpSeen = (): void => {
  try { localStorage.setItem(KEY, '1') } catch { /* see above */ }
}
