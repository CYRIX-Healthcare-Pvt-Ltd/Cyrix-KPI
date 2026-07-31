import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { parseKpiWorkbook, type ParseResult } from './excel'

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
