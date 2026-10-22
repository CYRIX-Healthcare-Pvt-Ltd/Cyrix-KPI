import type { Employee, KpiSubmission, KpiSubmissionItem } from '@/types/db'
import { supabase } from './supabase'
import { openFyMonths, monthLabel } from './fy'

/**
 * KPI score export for managers and HR.
 *
 * Layout, matching the shape people already read in the annual sheet:
 *
 *   | Ecode | Name | Designation | Department | Apr-26 | May-26 | Jun-26 | Q1 Avg | Jul-26 | … | Annual Avg |
 *
 * Each month is a merged block: Job Role %, Job Role Actual, Core Value %, Total, Total Actual
 * (the user, 19 Oct: "quarter wise average also, and actual job role score and actual total score",
 * "like we did in the team member wise report"). Actual is each job-role KPI's achievement times its
 * weightage with no cap — 200 against a target of 100 on a 40% row is 80, beside the score that stops
 * at 40 — added up; Total Actual is that plus ESMS's actual and the core values. After each quarter's
 * last month its average, and the year's at the end. Beside Job Role Actual, Job Role Achievement %:
 * that actual out of the 80 Job Role is marked on (the user, 22 Oct: "job role ach % out of 80, ie actual / 80").
 *
 * Averages are over scored months only — averaging in an unscored month as zero would quietly drag
 * everyone down. An ESMS column joins each block only when somebody in this export carries ESMS.
 *
 * ExcelJS, as the team member wise report: the community SheetJS writes no colours or borders.
 */

export interface ExportRow {
  employee: Employee
  submissions: KpiSubmission[]
}

const SCORED = new Set(['scored', 'finalized'])
/** What Job Role is marked out of: the 80 of the 80 / 20 split with Core Values. */
const JOB_ROLE_OUT_OF = 80
const ACH = 'Job Role Achievement %'
type Item = Pick<KpiSubmissionItem, 'submission_id' | 'section' | 'weightage' | 'scoring_rule' | 'target_value'
  | 'manager_achieved' | 'self_achieved' | 'final_score' | 'manager_score' | 'self_score'>

/** A KPI row's actual score, as the team member wise report works it out: achievement × weightage, no cap. */
function actualOf(it: Item): number | null {
  const target = it.target_value ?? null
  const achieved = it.manager_achieved ?? it.self_achieved ?? null
  const score = it.final_score ?? it.manager_score ?? it.self_score ?? null
  if (!target || achieved === null) return score
  const lower = String(it.scoring_rule).startsWith('lower')
  const pct = lower ? (achieved > 0 ? (target / achieved) * 100 : 100) : (achieved / target) * 100
  return (pct * Number(it.weightage)) / 100
}

/** The scored months' KPI rows, a hundred months at a time and paged past the 1,000-row cap. */
async function itemsOf(subIds: string[]): Promise<Item[]> {
  const out: Item[] = []
  for (let i = 0; i < subIds.length; i += 100) {
    const part = subIds.slice(i, i + 100)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('kpi_submission_items')
        .select('submission_id, section, weightage, scoring_rule, target_value, manager_achieved, self_achieved, final_score, manager_score, self_score')
        .in('submission_id', part).order('submission_id').order('sort_order').range(from, from + 999)
      if (error) throw new Error(error.message)
      out.push(...((data ?? []) as Item[]))
      if ((data ?? []).length < 1000) break
    }
  }
  return out
}

type Block = { kind: 'month'; month: string } | { kind: 'quarter'; label: string; months: string[] } | { kind: 'year' }
/** April to June is Q1, as the financial year runs. */
const quarterOf = (m: string) => { const mo = Number(m.slice(5, 7)); return mo >= 4 ? Math.floor((mo - 4) / 3) + 1 : 4 }

export async function exportKpiScores(rows: ExportRow[], fy: string, filename: string) {
  const { default: ExcelJS } = await import('exceljs')
  // Only months that have finished: a column for a month nobody could have been assessed on is noise.
  const months = openFyMonths(fy)
  const blocks: Block[] = []
  months.forEach((m, i) => {
    blocks.push({ kind: 'month', month: m })
    const next = months[i + 1]
    if (!next || quarterOf(next) !== quarterOf(m)) blocks.push({ kind: 'quarter', label: `Q${quarterOf(m)} Avg`, months: months.filter(x => quarterOf(x) === quarterOf(m)) })
  })
  blocks.push({ kind: 'year' })

  const withEsms = rows.some(r => r.submissions.some(s => s.final_esms_score !== null || s.self_esms_score !== null))
  const subHead = withEsms
    ? ['Job Role %', 'Job Role Actual', ACH, 'ESMS %', 'Core Value %', 'Total', 'Total Actual']
    : ['Job Role %', 'Job Role Actual', ACH, 'Core Value %', 'Total', 'Total Actual']
  const W = subHead.length
  const isActual = (k: number) => subHead[k].endsWith('Actual')
  const isAch = (k: number) => subHead[k] === ACH

  // Each scored month's actual job role and ESMS, from its KPI rows.
  const scored = rows.flatMap(r => r.submissions.filter(s => SCORED.has(s.status)))
  const items = await itemsOf(scored.map(s => s.id))
  const actual = new Map<string, { job: number; esms: number; hasJob: boolean; hasEsms: boolean }>()
  for (const it of items) {
    if (it.section !== 'job_role' && it.section !== 'esms') continue
    const a = actual.get(it.submission_id) ?? { job: 0, esms: 0, hasJob: false, hasEsms: false }
    const v = actualOf(it) ?? 0
    if (it.section === 'job_role') { a.job += v; a.hasJob = true } else { a.esms += v; a.hasEsms = true }
    actual.set(it.submission_id, a)
  }

  // ---- the figures: one line of numbers per person, a block per month, quarter and year ----
  const lines = rows.map(({ employee, submissions }) => {
    const byMonth = new Map(submissions.map(s => [s.period_month, s]))
    const perMonth = new Map<string, (number | null)[]>()
    for (const m of months) {
      const s = byMonth.get(m)
      if (!s || !SCORED.has(s.status)) { perMonth.set(m, Array(W).fill(null)); continue }
      const job = s.final_job_role_score ?? s.self_job_role_score
      const es = s.final_esms_score ?? s.self_esms_score
      const core = s.final_core_score ?? s.self_core_score
      const total = s.final_total_score ?? s.self_total_score
      const a = actual.get(s.id)
      const jobActual = a?.hasJob ? a.job : job
      const esmsActual = a?.hasEsms ? a.esms : es
      const totalActual = jobActual === null && total === null ? null : (jobActual ?? 0) + (esmsActual ?? 0) + (core ?? 0)
      const ach = jobActual === null ? null : jobActual / JOB_ROLE_OUT_OF
      perMonth.set(m, withEsms ? [job, jobActual, ach, es, core, total, totalActual] : [job, jobActual, ach, core, total, totalActual])
    }
    const mean = (ms: string[]) => Array.from({ length: W }, (_, k) => {
      const v = ms.map(m => perMonth.get(m)![k]).filter((x): x is number => x !== null && x !== undefined)
      return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null
    })
    const cells = blocks.flatMap(b => b.kind === 'month' ? perMonth.get(b.month)! : b.kind === 'quarter' ? mean(b.months) : mean(months))
    // The achievement is a share, kept to four places so 0.988 shows as 99% rather than rounding first.
    return [employee.ecode, employee.full_name, employee.designation ?? '', employee.department ?? '', ...cells.map((v, i) => (isAch(i % W) ? share(v) : num(v)))]
  })

  // ---- the sheet ----
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`KPI ${fy}`, { views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }] })
  const head1: (string | null)[] = ['Ecode', 'Name', 'Designation', 'Department']
  const head2: (string | null)[] = [null, null, null, null]
  for (const b of blocks) {
    head1.push(b.kind === 'month' ? monthLabel(b.month) : b.kind === 'quarter' ? b.label : 'Annual Avg', ...Array(W - 1).fill(null))
    head2.push(...subHead)
  }
  ws.addRow(head1); ws.addRow(head2)
  for (let c = 1; c <= 4; c++) ws.mergeCells(1, c, 2, c)
  blocks.forEach((_, i) => ws.mergeCells(1, 5 + i * W, 1, 4 + (i + 1) * W))

  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } }
  const grid = { top: thin, left: thin, bottom: thin, right: thin }
  const last = 4 + blocks.length * W
  // Months in alternating blues, each quarter's average in teal, the year's in green; an Actual heading a shade darker.
  let monthNo = 0
  const look = blocks.map(b => b.kind === 'month'
    ? { band: monthNo++ % 2 ? 'FF2563EB' : 'FF1D4ED8', head: 'FFDBEAFE', headActual: 'FFBFDBFE', cell: null as string | null, ink: 'FF1E3A8A' }
    : b.kind === 'quarter'
      ? { band: 'FF0F766E', head: 'FFCCFBF1', headActual: 'FF99F6E4', cell: 'FFF0FDFA', ink: 'FF134E4A' }
      : { band: 'FF15803D', head: 'FFDCFCE7', headActual: 'FFBBF7D0', cell: 'FFF0FDF4', ink: 'FF14532D' })
  const blockOf = (c: number) => (c <= 4 ? null : { b: Math.floor((c - 5) / W), k: (c - 5) % W })
  for (let c = 1; c <= last; c++) {
    const at = blockOf(c)
    const top = ws.getCell(1, c), sub = ws.getCell(2, c)
    top.fill = fill(at ? look[at.b].band : 'FF1E293B')
    top.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    top.alignment = { horizontal: 'center', vertical: 'middle' }
    top.border = grid
    if (at) {
      sub.fill = fill(isAch(at.k) ? 'FFFDE68A' : isActual(at.k) ? look[at.b].headActual : look[at.b].head)
      sub.font = { bold: true, color: { argb: look[at.b].ink } }
      sub.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    }
    sub.border = grid
  }
  ws.getRow(1).height = 20; ws.getRow(2).height = 30
  lines.forEach((line, i) => {
    const row = ws.addRow(line)
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (c > last) return
      const at = blockOf(c)
      cell.border = grid
      cell.alignment = { vertical: 'middle', horizontal: c <= 4 ? 'left' : 'center' }
      if (at && look[at.b].cell) { cell.fill = fill(look[at.b].cell!); cell.font = { bold: true } }
      else if (i % 2) cell.fill = fill('FFF8FAFC')
      if (at && typeof cell.value === 'number') cell.numFmt = isAch(at.k) ? '0%' : '0.00'
    })
  })
  ws.eachRow({ includeEmpty: true }, r => r.eachCell({ includeEmpty: true }, cell => { cell.font = { ...cell.font, name: 'Calibri', size: 10 } }))
  ws.columns = [{ width: 10 }, { width: 26 }, { width: 22 }, { width: 16 }, ...blocks.flatMap(() => subHead.map(h => ({ width: h === ACH ? 13 : h.endsWith('Actual') ? 12 : 11 })))]

  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** Blank cells rather than zeros, so an unscored month reads as unscored. */
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 100) / 100
const share = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 10000) / 10000

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

/**
 * Several tables in one workbook.
 *
 * exportOrgStatus writes one sheet, which is right for a single table. A
 * master upload answers two questions that belong together — who joined
 * and who left — and handing those over as two files is two things to
 * lose track of.
 *
 * An empty sheet is still written, with its headers on it. "Nobody left"
 * is an answer, and a tab that is missing entirely reads as an export
 * that went wrong.
 */
export async function exportSheets(
  sheets: Array<{
    name: string
    headers: string[]
    rows: Array<Record<string, unknown>>
  }>,
  filename: string,
) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: s.headers })
    ws['!cols'] = s.headers.map(h => ({ wch: Math.max(14, h.length + 2) }))
    // Excel refuses a tab name past 31 characters, and refuses the whole
    // file rather than truncating it.
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}
