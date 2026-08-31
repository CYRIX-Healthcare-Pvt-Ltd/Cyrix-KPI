/**
 * Reading a spreadsheet somebody actually made, and handing one back.
 *
 * Every bulk upload in this app takes a file that came out of Excel on
 * somebody's laptop, which means the column is called "Employee Code" or
 * "ecode" or "EMP CODE" depending on who saved it. Matching headers
 * loosely is not sloppiness — it is the difference between a feature that
 * works on the first try and one that sends people back to rename columns.
 *
 * The parsing lived inside the employee importer. A second and third
 * upload were about to copy it, so it lives here instead: three subtly
 * different ideas of what counts as an employee code is exactly the bug
 * nobody finds until a row is silently skipped.
 */

/** "Employee Code" and "employee_code" and "EMPCODE" are the same header. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The first non-empty value under any of these header names.
 *
 * Returns '' rather than null so callers can test truthiness without
 * distinguishing "column missing" from "cell blank" — for an upload they
 * mean the same thing, which is "this row does not say".
 */
export function pick(row: Record<string, unknown>, ...names: string[]): string {
  const map = Object.fromEntries(Object.keys(row).map(k => [key(k), k]))
  for (const n of names) {
    const hit = map[key(n)]
    if (hit && row[hit] != null && String(row[hit]).trim() !== '') {
      return String(row[hit]).trim()
    }
  }
  return ''
}

/**
 * The first sheet of a workbook, as plain rows.
 *
 * The first sheet on purpose: asking somebody which tab to use is a
 * question with one sensible answer that they should not have to give.
 * `xlsx` is imported at the point of use so it stays out of the main
 * bundle — it is 400 KB and most people never upload anything.
 */
export async function readSheet(file: File): Promise<Array<Record<string, unknown>>> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer())
  const first = wb.Sheets[wb.SheetNames[0]]
  if (!first) throw new Error('That file has no sheets in it.')
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(first, { defval: null })
}

/**
 * Hand back a workbook with the headers this upload expects, and a row
 * or two showing what goes in them.
 *
 * A template is worth more than a paragraph describing the columns: it
 * cannot be misread, and what comes back is a file that already matches.
 * The examples are real values from this company rather than "abc123",
 * so the shape of an employee code is obvious without being explained.
 */
export async function downloadTemplate(
  filename: string,
  headers: string[],
  examples: Array<Record<string, string>>,
): Promise<void> {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.json_to_sheet(examples, { header: headers })
  // Wide enough to read the headers without dragging every column out.
  sheet['!cols'] = headers.map(h => ({ wch: Math.max(16, h.length + 4) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Template')
  XLSX.writeFile(wb, filename)
}
