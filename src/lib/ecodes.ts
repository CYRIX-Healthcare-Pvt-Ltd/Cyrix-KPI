/**
 * Employee codes out of whatever somebody pasted.
 *
 * The list always exists somewhere else first — a column of a
 * spreadsheet, a WhatsApp message, an email from HR — so the separator
 * is whatever that source used, and often several at once. Commas,
 * spaces, tabs, newlines, semicolons, pipes, and any run of them.
 *
 * The prefix is kept. E, CT and FTC are all real, and the codes are
 * matched whole; stripping to digits would make E616 and CT616 the same
 * person, and they are not.
 *
 * Duplicates collapse, because a list pasted twice is one list.
 */
export function parseEcodes(pasted: string): string[] {
  const seen = new Set<string>()
  for (const part of pasted.split(/[\s,;|]+/)) {
    const code = part.trim().toUpperCase()
    if (code) seen.add(code)
  }
  return [...seen]
}
