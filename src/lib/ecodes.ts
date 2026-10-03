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

/** An employee code on more than one row of a sheet, and each row it is on (1 is the header). */
export interface RepeatedCode { ecode: string; rows: Array<{ row: number; name: string }> }

/**
 * Codes on more than one row of an employee sheet, matched as they are
 * stored — trimmed and upper-cased, so "e1000 " and "E1000" are one code.
 *
 * The bulk import writes every row in one statement, and Postgres refuses a
 * statement that would write the same employee twice: "ON CONFLICT DO
 * UPDATE command cannot affect row a second time", which is what HR saw on
 * 3 Oct with nothing to say which code. Found while the file is read, and
 * named with its rows, before anything is pressed. In the order they first
 * appear in the sheet.
 */
export function repeatedCodes(rows: ReadonlyArray<{ ecode: string; full_name: string; row: number }>): RepeatedCode[] {
  const byCode = new Map<string, Array<{ row: number; name: string }>>()
  for (const r of rows) {
    const code = r.ecode.trim().toUpperCase()
    if (!code) continue
    const seen = byCode.get(code)
    const line = { row: r.row, name: r.full_name.trim() }
    if (seen) seen.push(line); else byCode.set(code, [line])
  }
  return [...byCode]
    .filter(([, lines]) => lines.length > 1)
    .map(([ecode, lines]) => ({ ecode, rows: lines }))
    .sort((a, b) => a.rows[0].row - b.rows[0].row)
}
