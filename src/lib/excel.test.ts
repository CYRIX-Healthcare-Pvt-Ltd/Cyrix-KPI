import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { parseKpiWorkbook, ruleFromCappingLabel, type ParseResult } from './excel'

/**
 * Parses the real template if it is present on this machine. The file
 * lives outside the repo (it contains employee data), so these tests
 * skip rather than fail on a machine that doesn't have it.
 */
const TEMPLATE_PATH =
  'D:/OneDrive - CYRIX HEALTH CARE/Desktop/KPI 26-27 Template.xlsx'

const available = existsSync(TEMPLATE_PATH)
const maybe = available ? describe : describe.skip

maybe('parsing the real KPI 26-27 template', () => {
  let parsed: ParseResult

  beforeAll(() => {
    const buf = readFileSync(TEMPLATE_PATH)
    parsed = parseKpiWorkbook(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    )
  })

  it('picks the monthly sheet, not the annual summary', () => {
    expect(parsed.sheetName).toBe('Apr-26')
  })

  it('parses without errors', () => {
    expect(parsed.errors).toEqual([])
  })

  it('finds all five KPI rows', () => {
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows.map(r => r.kra)).toEqual([
      'Response time',
      'Service delivery',
      'Documentation & Reporting',
      'Service quality & reliability',
      'Customer Delight',
    ])
  })

  it('splits the sections 80/20', () => {
    expect(parsed.jobRoleTotal).toBe(80)
    expect(parsed.coreValuesTotal).toBe(20)
    expect(parsed.rows.filter(r => r.section === 'job_role')).toHaveLength(4)
    expect(parsed.rows.filter(r => r.section === 'core_values')).toHaveLength(1)
  })

  it('converts Excel percentages to weightage points', () => {
    expect(parsed.rows.map(r => r.weightage)).toEqual([25, 25, 20, 10, 20])
  })

  it('reads the targets, including the meaningful zero', () => {
    expect(parsed.rows.map(r => r.target_value)).toEqual([100, 100, 35, 0, 100])
  })

  it('recovers each scoring rule from the cell formula', () => {
    expect(parsed.rows.map(r => r.scoring_rule)).toEqual([
      'higher_capped',  // MIN(F4/E4*D4, D4)
      'higher_capped',  // MIN(F5/E5*D5, D5)
      'lower_penalty',  // IF(F6<=E6, D6, D6-(D6*(100%-(E6/F6))))
      'lower_penalty',  // IF(F7<=E7, D7, D7-(D7*(100%-(E7/F7))))
      'rating_scale',   // core values block
    ])
  })

  it('does not need to guess any rule for this file', () => {
    expect(parsed.rows.filter(r => r.rule_inferred)).toEqual([])
  })

  it('extracts the five core values with their descriptions', () => {
    expect(parsed.coreValues.map(c => c.name)).toEqual([
      'Continuous Learning',
      'Building Relationships',
      'Trust',
      'Care',
      'Speed of Response',
    ])
    expect(parsed.coreValues[0].description).toContain('learning attitude')
  })

  it('carries the KPI descriptions through', () => {
    expect(parsed.rows[0].kpi_description).toBe(
      'BD calls assigned to be attended within 48 hours',
    )
  })
})

/**
 * ESMS detection, on a sheet built here rather than read from disk.
 *
 * The real template lives outside the repo, so the tests above skip on a
 * machine without it — which is most of them, and which is exactly when
 * a parser change goes in unverified. These build the grid in memory, so
 * they run everywhere.
 */
function sheetOf(rows: Array<Array<string | number | null>>): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Apr-26')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const HEADER = ['KRA& Weightage', 'KRA', 'KPI (Mesurable Parameter)', 'Weightage', 'Target KPI']

describe('the ESMS band', () => {
  it('reads 80 / 5 / 15 as a valid sheet', () => {
    const parsed = parseKpiWorkbook(sheetOf([
      ['Ecode :', 'Name :'],
      HEADER,
      ['Job Role - 80%', 'Audit Planning & Execution', 'Audits conducted vs planned', 20, 100],
      [null, 'Non-Conformance', 'NC closure within TAT', 15, 100],
      [null, 'Training and quality Awareness', 'Plan Vs Execution', 15, 100],
      [null, 'TRA', 'Ensure TRA to be done on time', 15, 100],
      [null, 'Team Handling', 'Team Retension', 15, 100],
      ['ESMS', 'ESMS Monitoring and reporting', 'Incident reporting within TAT', 5, 100],
      ['Alignment To Core Values - 20%', 'Customer Delight', 'Delivers a positive experience', 15, 100],
    ]))

    expect(parsed.errors).toEqual([])
    expect(parsed.hasEsms).toBe(true)
    expect(parsed.jobRoleTotal).toBe(80)
    expect(parsed.esmsTotal).toBe(5)
    expect(parsed.coreValuesTotal).toBe(15)
    expect(parsed.rows.find(r => r.section === 'esms')?.kra)
      .toBe('ESMS Monitoring and reporting')
  })

  it('still reads 80 / 20 with no ESMS band at all', () => {
    const parsed = parseKpiWorkbook(sheetOf([
      ['Ecode :', 'Name :'],
      HEADER,
      ['Job Role - 80%', 'Response time', 'BD calls within 48 hours', 80, 100],
      ['Alignment To Core Values - 20%', 'Customer Delight', 'Delivers a positive experience', 20, 100],
    ]))

    expect(parsed.errors).toEqual([])
    expect(parsed.hasEsms).toBe(false)
    expect(parsed.coreValuesTotal).toBe(20)
    expect(parsed.esmsTotal).toBe(0)
  })

  it('rejects a remainder that does not reach 20, and names both parts', () => {
    const parsed = parseKpiWorkbook(sheetOf([
      ['Ecode :', 'Name :'],
      HEADER,
      ['Job Role - 80%', 'Response time', 'BD calls within 48 hours', 80, 100],
      ['ESMS', 'ESMS Monitoring and reporting', 'Incident reporting within TAT', 5, 100],
      ['Alignment To Core Values - 20%', 'Customer Delight', 'Delivers a positive experience', 10, 100],
    ]))

    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0]).toContain('15%')
    expect(parsed.errors[0]).toContain('10% + 5%')
  })

  it('does not mistake "Alignment To Core Values" for an ESMS band', () => {
    const parsed = parseKpiWorkbook(sheetOf([
      ['Ecode :', 'Name :'],
      HEADER,
      ['Job Role - 80%', 'Response time', 'BD calls within 48 hours', 80, 100],
      ['Alignment To Core Values - 20%', 'Customer Delight', 'Delivers a positive experience', 20, 100],
    ]))
    expect(parsed.rows.map(r => r.section)).toEqual(['job_role', 'core_values'])
  })
})

describe('the bulk template round-trips', () => {
  /** Exactly what downloadBulkTemplate() writes. */
  function templateBuffer(): ArrayBuffer {
    const rows = [
      ['KRA& Weightage', 'KRA', 'KPI (Mesurable Parameter)', 'Weightage', 'Target KPI', 'Capping', 'If lower Capping'],
      ['Job Role - 80%', 'Cost Efficiency', 'R&M vs revenue', 0.4, 100, 'Lower is better (min 0 %)', 1],
      ['Job Role - 80%', 'Breakdown Management', 'Closed in 30 days', 0.2, 0, 'Lower is better (can go below 0 %)', 2],
      ['Job Role - 80%', 'Organic Growth', 'Asset value addition', 0.1, 100, 'Higher is better (max weightage)', ''],
      ['Job Role - 80%', 'Team Handling', 'Team retention', 0.1, 100, 'Higher is better (can exceed weightage)', ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    for (let r = 1; r < rows.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: 3 })
      if (ws[ref]) (ws[ref] as XLSX.CellObject).z = '0%'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Template')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ecode to upload'], ['E390']]), 'Ecode')
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  }

  it('reads every weightage back as the percentage it displays', () => {
    const { rows } = parseKpiWorkbook(templateBuffer())
    expect(rows.map(r => r.weightage)).toEqual([40, 20, 10, 10])
    expect(rows.reduce((a, r) => a + r.weightage, 0)).toBe(80)
  })

  it('takes the rule from the Capping column rather than guessing', () => {
    const { rows } = parseKpiWorkbook(templateBuffer())
    expect(rows.map(r => r.scoring_rule)).toEqual([
      'lower_penalty', 'lower_linear', 'higher_capped', 'higher_uncapped',
    ])
    expect(rows.every(r => !r.rule_inferred)).toBe(true)
  })

  it('reads "If lower Capping" as written, not as a fraction', () => {
    // 1 means one percent. The weightage column's "a bare 1 is probably
    // 100%" guess is right there and catastrophic here — it wiped a row
    // out on the first unit over.
    const { rows } = parseKpiWorkbook(templateBuffer())
    expect(rows[0].rule_params.penalty_per_unit).toBe(1)
    expect(rows[1].rule_params.penalty_per_unit).toBe(2)
  })

  it('leaves the per-unit figure off a higher-is-better row', () => {
    const { rows } = parseKpiWorkbook(templateBuffer())
    expect(rows[2].rule_params).toEqual({})
    expect(rows[3].rule_params).toEqual({})
  })
})

describe('ruleFromCappingLabel', () => {
  it('matches the four labels the template offers', () => {
    expect(ruleFromCappingLabel('Higher is better (max weightage)')).toBe('higher_capped')
    expect(ruleFromCappingLabel('Higher is better (can exceed weightage)')).toBe('higher_uncapped')
    expect(ruleFromCappingLabel('Lower is better (min 0 %)')).toBe('lower_penalty')
    expect(ruleFromCappingLabel('Lower is better (can go below 0 %)')).toBe('lower_linear')
  })

  it('matches on meaning, so old wording still resolves', () => {
    expect(ruleFromCappingLabel('Higher is better (capped at weightage)')).toBe('higher_capped')
    expect(ruleFromCappingLabel('Lower is better (linear, can go negative)')).toBe('lower_linear')
    expect(ruleFromCappingLabel('lower is better — -ve marks apply')).toBe('lower_linear')
  })

  it('says nothing rather than guessing when it cannot tell', () => {
    expect(ruleFromCappingLabel('')).toBeNull()
    expect(ruleFromCappingLabel('see note below')).toBeNull()
  })
})
