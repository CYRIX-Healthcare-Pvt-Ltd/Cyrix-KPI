import * as XLSX from 'xlsx'
import { supabase } from './supabase'
import { parseKpiWorkbook, type ParseResult } from './excel'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL, ESMS_WEIGHT } from './sections'

/**
 * One KRA set, many people.
 *
 * The workbook carries both halves of the job: a Template sheet holding
 * the rows, read by the same parser the individual setup screen uses, and
 * an Ecode sheet listing who gets them. Splitting them across two sheets
 * rather than repeating the rows per person is what makes a file for two
 * hundred people the same size as a file for two.
 */

/** What happened to one employee, in the words the result file uses. */
export interface BulkOutcome {
  ecode: string
  name: string
  status: 'Created' | 'Replaced' | 'Skipped' | 'Failed'
  detail: string
}

export interface BulkPlan {
  parsed: ParseResult
  ecodes: string[]
  /** Fatal — the file cannot be applied at all. */
  errors: string[]
  warnings: string[]
}

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * Every code on the Ecode sheet.
 *
 * Read by position rather than by header, because the sheet is one column
 * and its heading has been spelled three ways already. Anything that
 * looks like a heading is dropped, duplicates are collapsed -- a code
 * listed twice is one person, and applying to them twice would report
 * "replaced" for an upload that only ever created.
 */
export function readEcodeSheet(wb: XLSX.WorkBook): { ecodes: string[]; warnings: string[] } {
  const warnings: string[] = []
  const name = wb.SheetNames.find(n => /ecode|employee|staff/i.test(n))
  if (!name) return { ecodes: [], warnings: ['No "Ecode" sheet found in that file.'] }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false })
  const seen = new Set<string>()
  const ecodes: string[] = []
  let dupes = 0

  for (const row of rows) {
    const cell = norm(row?.[0])
    if (!cell) continue
    // A heading, not a code: "Ecode to upload", "Employee code".
    if (/^(ecode|employee|staff|code)\b/i.test(cell) || cell.includes(' ')) continue
    const key = cell.toUpperCase()
    if (seen.has(key)) { dupes++; continue }
    seen.add(key)
    ecodes.push(cell)
  }

  if (dupes > 0) warnings.push(`${dupes} duplicate code(s) on the Ecode sheet were listed once.`)
  if (ecodes.length === 0) warnings.push(`The "${name}" sheet has no employee codes on it.`)
  return { ecodes, warnings }
}

/**
 * Reads the workbook and says whether it can be applied.
 *
 * Nothing is written here. The screen shows what was understood -- the
 * rows, the totals, the people -- and applying is a second, deliberate
 * step, because this writes to two hundred records at once and a file
 * misread is not something to discover afterwards.
 */
export function planBulkUpload(buf: ArrayBuffer): BulkPlan {
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellNF: true })
  const parsed = parseKpiWorkbook(buf)
  const { ecodes, warnings } = readEcodeSheet(wb)

  const errors = [...parsed.errors]
  const jobRows = parsed.rows.filter(r => r.section === 'job_role')

  if (jobRows.length === 0 && errors.length === 0) {
    errors.push('No Job Role rows were found on the template sheet.')
  }

  /*
    The weightage check, which is the one that catches a file typed in the
    wrong units.

    Excel stores 40% as 0.4, and the parser converts using the cell's
    format -- so a column formatted as a percentage arrives as 40 and one
    typed as bare numbers arrives as 40 too. What neither can survive is
    the total being wrong: a sheet of fractions read as whole numbers
    totals 0.8, and a sheet missing a row totals 70. Both are stopped
    here, and the message names the figure so the sheet can be checked
    against it rather than guessed at.
  */
  const jobTotal = round1(jobRows.reduce((a, r) => a + r.weightage, 0))
  if (errors.length === 0 && jobTotal !== JOB_ROLE_TOTAL) {
    errors.push(
      `The Job Role weightages add up to ${jobTotal}%, not ${JOB_ROLE_TOTAL}%. ` +
      'Enter each one as a percentage — 40% or 40, not 0.4 in a column formatted as a plain number.',
    )
  }

  for (const r of jobRows) {
    if (!r.kra.trim()) errors.push(`Row ${r.sourceRow} has a weightage but no KRA.`)
  }

  if (ecodes.length === 0 && errors.length === 0) {
    errors.push('The Ecode sheet lists nobody to assign these to.')
  }

  return { parsed, ecodes, errors, warnings: [...parsed.warnings, ...warnings] }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Applies the plan, one person at a time, reporting each.
 *
 * Sequential rather than in parallel, and that is not an oversight: two
 * hundred concurrent writes to the same two tables is a lock storm, and
 * the point of this screen is a result you can read afterwards rather
 * than the fastest possible finish.
 */
export async function applyBulkUpload(
  plan: BulkPlan,
  fy: string,
  onProgress: (done: number, total: number) => void,
): Promise<BulkOutcome[]> {
  const rows = plan.parsed.rows
    .filter(r => r.section === 'job_role')
    .map(r => ({
      section: r.section,
      kra: r.kra,
      kpi_description: r.kpi_description,
      weightage: r.weightage,
      target_value: r.target_value,
      target_unit: r.target_unit,
      scoring_rule: r.scoring_rule,
      rule_params: r.rule_params,
      sort_order: r.sort_order,
    }))

  // The sheet decides whether these people carry ESMS, the same way it
  // does for one person on the setup screen. Core values takes what is
  // left, so the three always add to 100 whatever the sheet said.
  const esms = plan.parsed.hasEsms ? ESMS_WEIGHT : 0
  const core = REMAINDER_TOTAL - esms

  const out: BulkOutcome[] = []
  for (const [i, ecode] of plan.ecodes.entries()) {
    try {
      const { data, error } = await supabase.rpc('bulk_assign_kpi', {
        p_ecode: ecode,
        p_fy: fy,
        p_rows: rows,
        p_job_weight: JOB_ROLE_TOTAL,
        p_core_weight: core,
        p_esms_weight: esms,
        p_starts_from: null,
      })
      if (error) throw new Error(error.message)
      const res = data as { status: string; detail: string; employee?: string }
      out.push({
        ecode,
        name: res.employee ?? '—',
        status: (res.status.charAt(0).toUpperCase() + res.status.slice(1)) as BulkOutcome['status'],
        detail: res.detail,
      })
    } catch (e) {
      out.push({
        ecode,
        name: '—',
        status: 'Failed',
        detail: e instanceof Error ? e.message : 'Unknown error',
      })
    }
    onProgress(i + 1, plan.ecodes.length)
  }
  return out
}

/**
 * The blank workbook, in the shape this screen reads back.
 *
 * Written rather than described, because every rule on the upload screen
 * is a rule about a file somebody has to produce, and the surest way to
 * produce the right one is to be handed it. The example rows are real
 * enough to run: filled in, they total 80% and would apply.
 *
 * The weightage column is formatted as a percentage and holds 0.4, which
 * is how Excel stores 40% — so the file reads back as 40 whether it is
 * edited in Excel or replaced wholesale with plain numbers.
 */
export function downloadBulkTemplate(): void {
  const header = [
    'KRA& Weightage',
    'KRA',
    'KPI (Mesurable Parameter)',
    'Weightage',
    'Target KPI',
    'Capping',
    'If lower Capping',
  ]

  const rows: (string | number)[][] = [
    header,
    [
      'Job Role - 80%',
      'Financial: Cost Efficiency in Asset Maintenance',
      'Repair & Maintenance expense measured against revenue.',
      0.4, 100, 'Lower is better (min 0 %)', 1,
    ],
    [
      'Job Role - 80%',
      'Breakdown Management',
      'All open breakdown calls closed within 30 days.',
      0.2, 0, 'Lower is better (can go below 0 %)', 2,
    ],
    [
      'Job Role - 80%',
      'Organic Growth',
      'Asset value addition — 1% of assets under scope added each month.',
      0.1, 100, 'Higher is better (max weightage)', '',
    ],
    [
      'Job Role - 80%',
      'Team Handling',
      'Team retention.',
      0.1, 100, 'Higher is better (can exceed weightage)', '',
    ],
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 20 }, { wch: 42 }, { wch: 60 }, { wch: 11 }, { wch: 11 }, { wch: 34 }, { wch: 16 },
  ]
  // Percent format on the weightage column, so 0.4 reads as 40% on screen
  // and comes back as 40 through the parser.
  for (let r = 1; r < rows.length; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 3 })
    if (ws[ref]) (ws[ref] as XLSX.CellObject).z = '0%'
  }

  const ecodes = XLSX.utils.aoa_to_sheet([['Ecode to upload'], ['E390'], ['E772']])
  ecodes['!cols'] = [{ wch: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  XLSX.utils.book_append_sheet(wb, ecodes, 'Ecode')
  XLSX.writeFile(wb, 'kpi_bulk_template.xlsx')
}

/**
 * The result, as a file.
 *
 * Two hundred outcomes is not something to read off a screen and
 * remember. It downloads so it can be kept, mailed, or worked through --
 * the skipped rows are a to-do list, and a to-do list you cannot save is
 * one nobody does.
 */
export function downloadBulkResult(outcomes: BulkOutcome[], fy: string): void {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['Employee Code', 'Name', 'Result', 'Detail'],
    ...outcomes.map(o => [o.ecode, o.name, o.status, o.detail]),
  ])
  ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 52 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Result')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `kpi_bulk_upload_${fy}_${stamp}.xlsx`)
}
