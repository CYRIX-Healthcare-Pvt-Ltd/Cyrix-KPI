import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildBulkTemplate, readEcodeSheet, readStartMonth } from './bulkKpi'
import { parseKpiWorkbook } from './excel'

/**
 * The template every uploader starts from, read back through the parser
 * that will read theirs.
 *
 * Round-tripped rather than inspected cell by cell, because what matters
 * is not what the file contains but what the other side of this module
 * makes of it — the two places that have disagreed before are the
 * percentage columns, where the cell's number format is the only thing
 * separating 40% from 0.4 and 1% from 100%.
 */
function roundTrip(): ArrayBuffer {
  const out = XLSX.write(buildBulkTemplate(), { type: 'array', bookType: 'xlsx', cellStyles: true })
  return out as ArrayBuffer
}

describe('the bulk template', () => {
  it('reads back as a valid, applicable file', () => {
    const parsed = parseKpiWorkbook(roundTrip())
    expect(parsed.errors).toEqual([])
    expect(parsed.jobRoleTotal).toBe(80)
  })

  it('carries no core values — they are the company\'s and added on save', () => {
    const parsed = parseKpiWorkbook(roundTrip())
    expect(parsed.rows.every(r => r.section === 'job_role')).toBe(true)
    expect(parsed.coreValuesTotal).toBe(0)
    expect(parsed.hasEsms).toBe(false)
  })

  it('keeps the four rules apart', () => {
    const parsed = parseKpiWorkbook(roundTrip())
    expect(parsed.rows.map(r => r.scoring_rule)).toEqual([
      'higher_capped', 'higher_uncapped', 'lower_penalty', 'lower_linear',
    ])
  })

  /*
    The bug this exists for: "If lower Capping" holding 0.01 in a
    percent-formatted cell means 1%, not 100%. Read as 100 it wipes a row
    out on the first unit over the target.
  */
  it('reads the per-unit penalty as percentage points, not as a fraction', () => {
    const parsed = parseKpiWorkbook(roundTrip())
    expect(parsed.rows[2].rule_params).toEqual({ penalty_per_unit: 0.2 })
    expect(parsed.rows[3].rule_params).toEqual({ penalty_per_unit: 1 })
  })

  it('lists who to assign to, and when each of them starts', () => {
    const wb = XLSX.read(roundTrip(), { type: 'array', cellDates: true })
    expect(readEcodeSheet(wb).targets).toEqual([
      { ecode: 'E390', startsFrom: '2026-09-01' },
      { ecode: 'E772', startsFrom: '2026-09-01' },
    ])
  })
})

describe('reading a start month', () => {
  it('takes every shape a sheet writes one in', () => {
    expect(readStartMonth('Sep-26')).toBe('2026-09-01')
    expect(readStartMonth('September 2026')).toBe('2026-09-01')
    expect(readStartMonth('Sep/26')).toBe('2026-09-01')
    expect(readStartMonth('2026-09')).toBe('2026-09-01')
    expect(readStartMonth('2026-9')).toBe('2026-09-01')
    // A real date cell, and always the 1st: the KPI covers a month.
    expect(readStartMonth(new Date(2026, 8, 14))).toBe('2026-09-01')
  })

  it('answers null rather than guessing', () => {
    expect(readStartMonth('')).toBeNull()
    expect(readStartMonth(null)).toBeNull()
    expect(readStartMonth('later')).toBeNull()
    expect(readStartMonth('Smurf-26')).toBeNull()
    expect(readStartMonth('2026-13')).toBeNull()
  })
})

describe('the ecode sheet', () => {
  const sheetOf = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Ecode')
    return wb
  }

  it('leaves the record alone when no month is given', () => {
    const { targets, warnings } = readEcodeSheet(sheetOf([['Ecode to upload'], ['E390']]))
    expect(targets).toEqual([{ ecode: 'E390', startsFrom: null }])
    expect(warnings).toEqual([])
  })

  it('says so when a month could not be read, rather than dropping it', () => {
    const { targets, warnings } = readEcodeSheet(
      sheetOf([['Ecode to upload', 'KPI starts from'], ['E390', 'whenever']]))
    expect(targets).toEqual([{ ecode: 'E390', startsFrom: null }])
    expect(warnings.join(' ')).toContain('could not be read')
  })

  it('counts a code listed twice as one person', () => {
    const { targets, warnings } = readEcodeSheet(
      sheetOf([['Ecode'], ['E390'], ['e390'], ['E772']]))
    expect(targets.map(t => t.ecode)).toEqual(['E390', 'E772'])
    expect(warnings.join(' ')).toContain('duplicate')
  })
})
