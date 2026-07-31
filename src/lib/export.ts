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
 * Each month is a merged three-column block. The averages at the end are
 * over scored months only — averaging in an unscored month as zero would
 * quietly drag everyone down.
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

  // ---- two header rows, the first merged across each month block ----
  const head1: (string | null)[] = ['Ecode', 'Name', 'Designation', 'Department']
  const head2: (string | null)[] = ['', '', '', '']

  for (const m of months) {
    head1.push(monthLabel(m), null, null)
    head2.push('Job Role %', 'Core Value %', 'Total')
  }
  head1.push('Average', null, null)
  head2.push('Job Role %', 'Core Value %', 'Total')

  const body = rows.map(({ employee, submissions }) => {
    const byMonth = new Map(submissions.map(s => [s.period_month, s]))
    const line: (string | number | null)[] = [
      employee.ecode,
      employee.full_name,
      employee.designation ?? '',
      employee.department ?? '',
    ]

    const jobs: number[] = []
    const cores: number[] = []
    const totals: number[] = []

    for (const m of months) {
      const s = byMonth.get(m)
      const scored = s && SCORED.has(s.status)
      const job = scored ? s.final_job_role_score ?? s.self_job_role_score : null
      const core = scored ? s.final_core_score ?? s.self_core_score : null
      const total = scored ? s.final_total_score ?? s.self_total_score : null

      if (job !== null && job !== undefined) jobs.push(job)
      if (core !== null && core !== undefined) cores.push(core)
      if (total !== null && total !== undefined) totals.push(total)

      line.push(num(job), num(core), num(total))
    }

    const mean = (a: number[]) =>
      a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null

    line.push(num(mean(jobs)), num(mean(cores)), num(mean(totals)))
    return line
  })

  const ws = XLSX.utils.aoa_to_sheet([head1, head2, ...body])

  // Merge each month label across its three columns, and the four
  // identity columns down across both header rows.
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = []
  for (let c = 0; c < 4; c++) {
    merges.push({ s: { r: 0, c }, e: { r: 1, c } })
  }
  for (let i = 0; i <= months.length; i++) {
    const start = 4 + i * 3
    merges.push({ s: { r: 0, c: start }, e: { r: 0, c: start + 2 } })
  }
  ws['!merges'] = merges

  ws['!cols'] = [
    { wch: 10 }, { wch: 26 }, { wch: 20 }, { wch: 18 },
    ...Array.from({ length: (months.length + 1) * 3 }, () => ({ wch: 11 })),
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
