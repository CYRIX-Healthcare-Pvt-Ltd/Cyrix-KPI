import type { Employee, KpiSubmission } from '@/types/db'
import { openFyMonths, monthLabel } from './fy'

/**
 * KPI score export for managers and HR.
 *
 * Layout, matching the shape people already read in the annual sheet:
 *
 *   | Ecode | Name | Designation | Department |   Apr-26    |   May-26    | … | Average |
 *   |       |      |             |            | Job | CV | Total | Job | CV | Total |  …
 *
 * Each month is a merged block. The averages at the end are over scored
 * months only — averaging in an unscored month as zero would quietly
 * drag everyone down.
 *
 * An ESMS column joins each block only when somebody in this export
 * actually carries ESMS. A team where nobody does gets the file it has
 * always got, rather than a column of blanks to explain.
 *
 * xlsx is imported dynamically: it is a large dependency and only the two
 * screens with a download button ever need it.
 */

export interface ExportRow {
  employee: Employee
  submissions: KpiSubmission[]
}

const SCORED = new Set(['scored', 'finalized'])

export async function exportKpiScores(
  rows: ExportRow[],
  fy: string,
  filename: string,
) {
  const XLSX = await import('xlsx')
  // Only months that have finished. A column for a month nobody could
  // have been assessed on is noise at best and misleading at worst.
  const months = openFyMonths(fy)

  const withEsms = rows.some(r =>
    r.submissions.some(s => s.final_esms_score !== null || s.self_esms_score !== null))
  const blockCols = withEsms ? 4 : 3

  // ---- two header rows, the first merged across each month block ----
  const head1: (string | null)[] = ['Ecode', 'Name', 'Designation', 'Department']
  const head2: (string | null)[] = ['', '', '', '']

  const subHead = withEsms
    ? ['Job Role %', 'ESMS %', 'Core Value %', 'Total']
    : ['Job Role %', 'Core Value %', 'Total']

  for (const m of months) {
    head1.push(monthLabel(m), ...Array(blockCols - 1).fill(null))
    head2.push(...subHead)
  }
  head1.push('Average', ...Array(blockCols - 1).fill(null))
  head2.push(...subHead)

  const body = rows.map(({ employee, submissions }) => {
    const byMonth = new Map(submissions.map(s => [s.period_month, s]))
    const line: (string | number | null)[] = [
      employee.ecode,
      employee.full_name,
      employee.designation ?? '',
      employee.department ?? '',
    ]

    const jobs: number[] = []
    const esms: number[] = []
    const cores: number[] = []
    const totals: number[] = []
    const keep = (bucket: number[], v: number | null | undefined) => {
      if (v !== null && v !== undefined) bucket.push(v)
    }

    for (const m of months) {
      const s = byMonth.get(m)
      const scored = s && SCORED.has(s.status)
      const job = scored ? s.final_job_role_score ?? s.self_job_role_score : null
      // Stays null for a person who carries no ESMS even in a file that
      // has the column, because somebody else in the team does.
      const es = scored ? s.final_esms_score ?? s.self_esms_score : null
      const core = scored ? s.final_core_score ?? s.self_core_score : null
      const total = scored ? s.final_total_score ?? s.self_total_score : null

      keep(jobs, job); keep(esms, es); keep(cores, core); keep(totals, total)

      line.push(num(job), ...(withEsms ? [num(es)] : []), num(core), num(total))
    }

    const mean = (a: number[]) =>
      a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null

    line.push(
      num(mean(jobs)),
      ...(withEsms ? [num(mean(esms))] : []),
      num(mean(cores)),
      num(mean(totals)),
    )
    return line
  })

  const ws = XLSX.utils.aoa_to_sheet([head1, head2, ...body])

  // Merge each month label across its own block, and the four identity
  // columns down across both header rows. blockCols rather than a 3, so
  // the merges cannot drift out of step with the columns they cover.
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = []
  for (let c = 0; c < 4; c++) {
    merges.push({ s: { r: 0, c }, e: { r: 1, c } })
  }
  for (let i = 0; i <= months.length; i++) {
    const start = 4 + i * blockCols
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: start + blockCols - 1 } })
  }
  ws['!merges'] = merges

  ws['!cols'] = [
    { wch: 10 }, { wch: 26 }, { wch: 20 }, { wch: 18 },
    ...Array.from({ length: (months.length + 1) * blockCols }, () => ({ wch: 11 })),
  ]
  ws['!freeze'] = { xSplit: 4, ySplit: 2 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `KPI ${fy}`)
  XLSX.writeFile(wb, filename)
}

/** Blank cells rather than zeros, so an unscored month reads as unscored. */
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 100) / 100

/**
 * Flat export of the whole organisation's KPI status, for HR.
 */
export async function exportOrgStatus(
  rows: Array<Record<string, unknown>>,
  filename: string,
  sheetName = 'KPI status',
) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = Object.keys(rows[0] ?? {}).map(k => ({ wch: Math.max(12, k.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}
