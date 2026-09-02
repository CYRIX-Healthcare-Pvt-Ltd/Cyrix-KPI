import * as XLSX from 'xlsx'
import type { ScoringRule, RuleParams } from './scoring'
import type { Section } from '@/types/db'

/**
 * Parser for "KPI 26-27 Template.xlsx".
 *
 * Expected monthly-sheet layout (row numbers from the real file):
 *   row 2   Ecode : | Name :
 *   row 3   KRA& Weightage | KRA | KPI (Mesurable Parameter) | Weightage
 *           | Target KPI | Target Achieved | Achieved Weightage | ...
 *   row 4+  the KPI rows; column A carries the section, merged down
 *   row 10+ the core-values rating block
 *
 * The scoring rule is recovered from the FORMULA in the "Achieved
 * Weightage" column, which is the only place the sheet records whether
 * exceeding the target helps or hurts:
 *   MIN(F/E*D, D)                  -> higher_capped
 *   IF(F<=E, D, D-(D*(100%-E/F)))  -> lower_penalty
 *
 * Everything is best-effort and surfaced for review — nothing is saved
 * without the user confirming the parsed grid on screen.
 */

export interface ParsedKpiRow {
  section: Section
  kra: string
  kpi_description: string | null
  weightage: number
  target_value: number | null
  target_unit: string | null
  scoring_rule: ScoringRule
  rule_params: RuleParams
  sort_order: number
  /** True when we guessed rather than read the rule from a formula. */
  rule_inferred: boolean
  sourceRow: number
}

export interface ParsedCoreValue {
  name: string
  description: string | null
  sort_order: number
}

export interface ParseResult {
  sheetName: string
  ecode: string | null
  employeeName: string | null
  rows: ParsedKpiRow[]
  coreValues: ParsedCoreValue[]
  warnings: string[]
  errors: string[]
  jobRoleTotal: number
  coreValuesTotal: number
  esmsTotal: number
  /** True when the sheet carried an ESMS band. */
  hasEsms: boolean
}

const norm = (v: unknown) =>
  String(v ?? '').replace(/\s+/g, ' ').trim()

const normKey = (v: unknown) => norm(v).toLowerCase()

/** Reads a cell's raw value plus its formula and number format. */
function cellAt(ws: XLSX.WorkSheet, row: number, col: number) {
  const ref = XLSX.utils.encode_cell({ r: row, c: col })
  const c = ws[ref] as XLSX.CellObject | undefined
  return {
    v: c?.v,
    f: typeof c?.f === 'string' ? c.f : null,
    z: typeof c?.z === 'string' ? c.z : null,
    text: norm(c?.w ?? c?.v),
  }
}

/**
 * Excel stores 25% as 0.25. Convert to weightage points (25) using the
 * number format when available, falling back to the magnitude.
 */
function toWeightagePoints(v: unknown, z: string | null): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  if (z?.includes('%')) return round3(v * 100)
  // No format info: a bare 0.25 is far more likely to be 25% than 0.25%.
  return round3(v <= 1 ? v * 100 : v)
}

/**
 * A figure already written as a percentage, unless Excel says otherwise.
 *
 * The weightage column guesses: a bare 0.25 there is far more likely to
 * mean 25% than a quarter of one percent, because weightages are tens.
 * That guess is wrong for "how much does one over the target cost",
 * where 1 means one percent and is an entirely ordinary answer — it read
 * 1 as 100% and wiped the row out on the first unit over.
 *
 * So only the cell's own format converts here. No format, no guess.
 */
function toPercentPoints(v: unknown, z: string | null): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return round3(z?.includes('%') ? v * 100 : v)
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * A rule named outright in the sheet's "Capping" column.
 *
 * Matched on what separates the four rather than on the whole label, so
 * the wording can be tidied without silently un-matching every file
 * written against the old one. Direction first, then the ceiling or the
 * floor — which is the same pair of questions the labels themselves ask.
 */
export function ruleFromCappingLabel(label: string): ScoringRule | null {
  const l = label.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!l) return null

  if (l.includes('higher')) {
    // "can exceed" / "can pass" / "uncapped" all mean the same ceiling.
    return /exceed|pass|uncapped|above|beyond/.test(l) ? 'higher_uncapped' : 'higher_capped'
  }
  if (l.includes('lower')) {
    // "below 0", "can go negative", "-ve": the floor is the whole question.
    return /below 0|below zero|negative|-ve/.test(l) ? 'lower_linear' : 'lower_penalty'
  }
  return null
}

function detectScoringRule(
  formula: string | null,
  section: Section,
  target: number | null,
): { rule: ScoringRule; inferred: boolean } {
  if (section === 'core_values') return { rule: 'rating_scale', inferred: false }

  if (formula) {
    const f = formula.toUpperCase().replace(/\s+/g, '')
    // IF(F<=E, D, D-(D*(100%-(E/F))))  — exceeding the target cuts the score
    if (f.includes('<=') && (f.includes('100%-') || f.includes('1-'))) {
      return { rule: 'lower_penalty', inferred: false }
    }
    // MIN(F/E*D, D) — rises to the weightage and stops there
    if (f.includes('MIN(')) return { rule: 'higher_capped', inferred: false }
    // No MIN wrapper on a ratio — overachievement is allowed to run past
    if (/\/[A-Z]+\d+\*/.test(f)) return { rule: 'higher_uncapped', inferred: false }
  }

  // No formula to read. A target of 0 can only sensibly mean "keep this
  // at zero", which is a lower-is-better KRA.
  if (target === 0) return { rule: 'lower_penalty', inferred: true }
  return { rule: 'higher_capped', inferred: true }
}

/** 'Job Role - 80%' / 'ESMS' / 'Alignment To Core Values - 20%' → section key. */
function sectionFromLabel(label: string): Section | null {
  const l = label.toLowerCase()
  if (!l) return null
  // Before core values: some sheets label the band "ESMS" and others
  // spell it out, and "Environmental and Social Management System" has
  // neither of the other two words in it, so order does not actually
  // matter — but ESMS reads first on the sheet, so it reads first here.
  if (/\besms\b/.test(l) || l.includes('environmental and social')) return 'esms'
  if (l.includes('core value') || l.includes('alignment')) return 'core_values'
  if (l.includes('job role')) return 'job_role'
  return null
}

/** Picks the monthly sheet — anything that isn't the annual summary. */
function pickSheet(wb: XLSX.WorkBook): string {
  const monthly = wb.SheetNames.find(n =>
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-\s]?\d{2,4}$/i.test(n.trim()),
  )
  if (monthly) return monthly
  const nonAnnual = wb.SheetNames.find(n => !/annual/i.test(n))
  return nonAnnual ?? wb.SheetNames[0]
}

export function parseKpiWorkbook(data: ArrayBuffer, sheetName?: string): ParseResult {
  const wb = XLSX.read(data, { cellFormula: true, cellNF: true })
  const name = sheetName ?? pickSheet(wb)
  const ws = wb.Sheets[name]

  const result: ParseResult = {
    sheetName: name,
    ecode: null,
    employeeName: null,
    rows: [],
    coreValues: [],
    warnings: [],
    errors: [],
    jobRoleTotal: 0,
    coreValuesTotal: 0,
    esmsTotal: 0,
    hasEsms: false,
  }

  if (!ws || !ws['!ref']) {
    result.errors.push(`Sheet "${name}" is empty.`)
    return result
  }

  const range = XLSX.utils.decode_range(ws['!ref'])

  // ---- locate the header row -------------------------------------------
  let headerRow = -1
  const colOf: Record<string, number> = {}

  for (let r = range.s.r; r <= Math.min(range.s.r + 20, range.e.r); r++) {
    const labels: Record<number, string> = {}
    for (let c = range.s.c; c <= range.e.c; c++) {
      labels[c] = normKey(cellAt(ws, r, c).text)
    }
    const values = Object.values(labels)
    const hasKra = values.some(v => v === 'kra')
    const hasWt = values.some(v => v.startsWith('weightage'))
    if (hasKra && hasWt) {
      headerRow = r
      for (const [cStr, label] of Object.entries(labels)) {
        const c = Number(cStr)
        if (label === 'kra') colOf.kra = c
        else if (label.includes('kra') && label.includes('weightage')) colOf.section = c
        else if (label.startsWith('kpi')) colOf.description = c
        else if (label.startsWith('weightage')) colOf.weightage = c
        else if (label.startsWith('target kpi')) colOf.target = c
        else if (label === 'target achieved' && colOf.selfAchieved === undefined) {
          colOf.selfAchieved = c
        } else if (label.includes('achieved weightage') && colOf.formula === undefined) {
          colOf.formula = c
        }
        // "If lower Capping" before "Capping": it contains the word, and
        // matching the shorter one first would claim both columns.
        else if (label.includes('capping') && label.includes('lower')) colOf.perUnit = c
        else if (label.includes('capping')) colOf.capping = c
      }
      break
    }
  }

  if (headerRow < 0) {
    result.errors.push(
      'Could not find the header row. Expected a row containing "KRA" and "Weightage" ' +
        '(row 3 in the standard template).',
    )
    return result
  }

  for (const required of ['kra', 'weightage'] as const) {
    if (colOf[required] === undefined) {
      result.errors.push(`Could not find the "${required}" column.`)
    }
  }
  if (result.errors.length) return result

  if (colOf.section === undefined) colOf.section = Math.max(0, colOf.kra - 1)
  if (colOf.formula === undefined) {
    result.warnings.push(
      'No "Achieved Weightage" formula column found — scoring rules were inferred ' +
        'from the targets. Please check the Rule column before saving.',
    )
  }

  // ---- employee identity (row above the header) -------------------------
  for (let r = range.s.r; r < headerRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const t = normKey(cellAt(ws, r, c).text)
      if (t.startsWith('ecode')) {
        const inline = norm(cellAt(ws, r, c).text).split(':')[1]
        result.ecode = norm(inline) || norm(cellAt(ws, r, c + 1).text) || null
      }
      if (t.startsWith('name')) {
        const inline = norm(cellAt(ws, r, c).text).split(':')[1]
        result.employeeName = norm(inline) || norm(cellAt(ws, r, c + 1).text) || null
      }
    }
  }

  // ---- KPI rows ---------------------------------------------------------
  let currentSection: Section | null = null
  let sortOrder = 0
  let blankStreak = 0

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const sectionLabel = norm(cellAt(ws, r, colOf.section).text)
    const detected = sectionFromLabel(sectionLabel)
    // Column A is merged down the block, so only the first row carries it.
    if (detected) currentSection = detected

    const kra = norm(cellAt(ws, r, colOf.kra).text)
    const wtCell = cellAt(ws, r, colOf.weightage)
    const weightage = toWeightagePoints(wtCell.v, wtCell.z)

    if (!kra || weightage === null) {
      // Two blank rows in a row means we've run off the end of the grid
      // and into the core-values rating block below it.
      if (++blankStreak >= 2) break
      continue
    }
    blankStreak = 0

    if (!currentSection) {
      result.warnings.push(
        `Row ${r + 1} ("${kra}") had no section above it — treated as Job Role.`,
      )
      currentSection = 'job_role'
    }

    const targetCell = colOf.target !== undefined ? cellAt(ws, r, colOf.target) : null
    const target =
      typeof targetCell?.v === 'number' && Number.isFinite(targetCell.v)
        ? targetCell.v
        : null

    const formula =
      colOf.formula !== undefined ? cellAt(ws, r, colOf.formula).f : null

    /*
      A named rule beats a guessed one.

      The old template said how a row scores only in the arithmetic of its
      "Achieved Weightage" formula, so the rule had to be reverse-engineered
      from it. The bulk template names it in a "Capping" column instead,
      which is both readable and not a guess — so when it is there it wins,
      and when it is not this falls back to the formula exactly as before.
    */
    const cappingLabel =
      colOf.capping !== undefined ? norm(cellAt(ws, r, colOf.capping).text) : ''
    const named = currentSection === 'core_values' ? null : ruleFromCappingLabel(cappingLabel)
    const { rule, inferred } = named
      ? { rule: named, inferred: false }
      : detectScoringRule(formula, currentSection, target)

    // "If lower Capping": what one over the target costs. Only the lower
    // rules take it, so a stray figure on a higher row is left alone
    // rather than written into params nothing will read.
    const perUnitCell = colOf.perUnit !== undefined ? cellAt(ws, r, colOf.perUnit) : null
    const perUnit =
      (rule === 'lower_linear' || rule === 'lower_penalty')
        ? toPercentPoints(perUnitCell?.v, perUnitCell?.z ?? null)
        : null

    result.rows.push({
      section: currentSection,
      kra,
      kpi_description:
        colOf.description !== undefined
          ? norm(cellAt(ws, r, colOf.description).text) || null
          : null,
      weightage,
      target_value: target,
      target_unit: targetCell?.z?.includes('%') ? '%' : null,
      scoring_rule: rule,
      // Zero is the absence of a penalty rather than a penalty of nothing,
      // which is the same reading the scoring engine takes.
      rule_params: perUnit != null && perUnit > 0 ? { penalty_per_unit: perUnit } : {},
      sort_order: ++sortOrder,
      rule_inferred: inferred,
      sourceRow: r + 1,
    })
  }

  // ---- core-values rating block ----------------------------------------
  // Sits below the grid: a label column, a description column, and a
  // formula column mapping Excellent/Very Good/... onto 100/80/60/...
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    let hasRatingFormula = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const f = cellAt(ws, r, c).f
      if (f && /EXCELLENT/i.test(f) && /VERY\s*GOOD/i.test(f)) {
        hasRatingFormula = true
        break
      }
    }
    if (!hasRatingFormula) continue

    const label = norm(cellAt(ws, r, range.s.c).text)
    const desc = norm(cellAt(ws, r, range.s.c + 1).text)
    if (label) {
      result.coreValues.push({
        name: label,
        description: desc || null,
        sort_order: result.coreValues.length + 1,
      })
    }
  }

  // ---- totals and validation -------------------------------------------
  const totalOf = (s: Section) => round3(
    result.rows.filter(r => r.section === s).reduce((a, b) => a + b.weightage, 0),
  )
  result.jobRoleTotal = totalOf('job_role')
  result.coreValuesTotal = totalOf('core_values')
  result.esmsTotal = totalOf('esms')
  result.hasEsms = result.rows.some(r => r.section === 'esms')

  if (result.rows.length === 0) {
    result.errors.push('No KPI rows were found below the header.')
  }
  if (result.jobRoleTotal !== 80) {
    result.errors.push(
      `Job Role weightages total ${result.jobRoleTotal}%, they must total 80%.`,
    )
  }
  // Checked as one block rather than two numbers. ESMS is carved out of
  // the core values 20% — 15 + 5 and 20 + 0 are both correct, and a
  // sheet with ESMS would otherwise fail for a core values total of 15
  // that is exactly what it should be.
  const remainder = round3(result.coreValuesTotal + result.esmsTotal)
  if (remainder !== 20) {
    result.errors.push(
      result.hasEsms
        ? `Core Values and ESMS total ${remainder}%, together they must total 20% ` +
          `(read as ${result.coreValuesTotal}% + ${result.esmsTotal}%).`
        : `Core Values weightages total ${remainder}%, they must total 20%.`,
    )
  }
  if (result.rows.some(r => r.rule_inferred)) {
    result.warnings.push(
      'Some scoring rules were inferred because the sheet had no formula to read. ' +
        'Check each highlighted row before saving.',
    )
  }

  return result
}

/** Sheet names the user can pick from if auto-detection chose wrong. */
export function listSheets(data: ArrayBuffer): string[] {
  return XLSX.read(data, { bookSheets: true }).SheetNames
}
