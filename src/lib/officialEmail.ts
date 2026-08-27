/**
 * Is this the address the company would write to?
 *
 * Checked on the client alone, on purpose. It is not a security control
 * — the server compares what was typed against the address actually on
 * the record, so a wrong one simply matches nothing and no code is sent.
 * This exists so somebody who types their personal address finds out
 * while looking at the field, rather than by waiting for an email that
 * was never going to arrive.
 */

export const OFFICIAL_DOMAIN = 'cyrix.in'

/**
 * The domain must EQUAL cyrix.in, not merely end with it.
 *
 * "Ending with cyrix.in" is the obvious reading and the wrong test:
 * notcyrix.in ends with it, and so does anything anybody registers
 * tomorrow with those nine characters at the end of it.
 */
const domainOf = (email: string) => {
  const at = email.lastIndexOf('@')
  return at === -1 ? null : email.slice(at + 1)
}

/**
 * Null when it is fine to send to. Otherwise the sentence to show,
 * written for somebody who is locked out and is not enjoying it.
 */
export function officialEmailProblem(raw: string): string | null {
  const email = (raw ?? '').trim().toLowerCase()

  // An empty field is not yet a mistake. Nagging somebody before they
  // have typed anything is how a form starts reading as broken.
  if (email === '') return null

  // "Address" on its own reads as where somebody lives, which is not the
  // thing being asked for. Every sentence here says email.
  const domain = domainOf(email)
  if (domain === null || domain === '') {
    return `Finish the email — official ones end in @${OFFICIAL_DOMAIN}`
  }

  if (domain !== OFFICIAL_DOMAIN) {
    return `Use your official @${OFFICIAL_DOMAIN} email, not a personal one`
  }

  // Only now is the local part worth complaining about, so somebody
  // halfway through typing is told the useful thing first.
  const local = email.slice(0, email.lastIndexOf('@'))
  if (local === '' || /[\s<>@,]/.test(local)) {
    return 'That does not look like an email address'
  }

  return null
}

/** Ready to send a code to. */
export const isOfficialEmail = (raw: string): boolean =>
  (raw ?? '').trim() !== '' && officialEmailProblem(raw) === null

/**
 * Has somebody typed a whole address, or are they still in the middle of
 * one?
 *
 * Decides when it is fair to complain. "kev" is not a mistake yet, and a
 * field that argues with every keystroke is one people learn to fight;
 * but somebody who has typed all of manoj@gmail.com should not have to
 * tab away to find out it will not work.
 */
export const looksFinished = (raw: string): boolean =>
  /@[^@\s]+\.[^@\s]{2,}$/.test((raw ?? '').trim())

/**
 * The message to show under the field right now — null while they are
 * still typing, or once it is right.
 */
export const emailFeedback = (raw: string, touched: boolean): string | null => {
  const problem = officialEmailProblem(raw)
  if (!problem) return null
  return touched || looksFinished(raw) ? problem : null
}
