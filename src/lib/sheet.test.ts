import { describe, it, expect } from 'vitest'
import { pick } from './sheet'
import { normaliseRole, SPARE_ROLES } from './spareRoles'

/**
 * The two failure modes of a bulk upload are both silent.
 *
 * A header that is not recognised skips every row and reports "no rows
 * had an employee code" — annoying, but visible. A *value* that is not
 * recognised skips one row in a thousand and reports success, which is
 * how one person keeps access somebody meant to take away. These are the
 * functions that decide both.
 */
describe('reading a column somebody named themselves', () => {
  const row = {
    'Employee Code': 'CT655',
    'Employee_Name': 'Mohamed Nafal',
    'ROLE ': 'Purchase',
    Empty: '   ',
    Missing: null,
  }

  it('matches a header however it was capitalised, spaced or punctuated', () => {
    expect(pick(row, 'employee_code')).toBe('CT655')
    expect(pick(row, 'Employee Code')).toBe('CT655')
    expect(pick(row, 'EMPLOYEECODE')).toBe('CT655')
    expect(pick(row, 'employee-code')).toBe('CT655')
  })

  it('takes the first name that hits, so callers can list synonyms', () => {
    expect(pick(row, 'ecode', 'employee_code', 'code')).toBe('CT655')
    // And the order matters: the first match wins, not the last.
    expect(pick(row, 'employee_name', 'employee_code')).toBe('Mohamed Nafal')
  })

  it('trims, and treats blank and missing as the same nothing', () => {
    expect(pick(row, 'role')).toBe('Purchase')
    expect(pick(row, 'Empty')).toBe('')
    expect(pick(row, 'Missing')).toBe('')
    expect(pick(row, 'NoSuchColumn')).toBe('')
  })

  it('falls through a blank column to the next name', () => {
    // A sheet with both columns present but the first one empty should
    // use the second, not give up.
    expect(pick(row, 'Empty', 'employee_code')).toBe('CT655')
  })
})

describe('reading a role somebody typed', () => {
  it('knows each of the four however it is written', () => {
    for (const [raw, expected] of [
      ['Engineer', 'engineer'],
      ['engineer', 'engineer'],
      ['ENG', 'engineer'],
      ['Technician', 'engineer'],
      ['Project Manager', 'project_manager'],
      ['project_manager', 'project_manager'],
      ['PM', 'project_manager'],
      ['Purchase', 'purchase'],
      ['purchasing', 'purchase'],
      ['Procurement', 'purchase'],
      ['Admin', 'admin'],
      ['Administrator', 'admin'],
    ] as const) {
      expect(normaliseRole(raw)).toBe(expected)
    }
  })

  it('refuses a word it does not know rather than guessing one', () => {
    // The dangerous version of this returns 'engineer' for anything
    // unrecognised: the upload then reports success while handing
    // somebody a role from a typo.
    for (const raw of ['supervisor', 'store keeper', 'xyz', '', '   ']) {
      expect(normaliseRole(raw)).toBeNull()
    }
  })

  it('offers every role it can parse, so the table and the sheet agree', () => {
    // A role in the picker that the importer cannot read would be
    // assignable by hand and silently skipped in bulk.
    for (const r of SPARE_ROLES) {
      expect(normaliseRole(r.label)).toBe(r.value)
      expect(normaliseRole(r.value)).toBe(r.value)
    }
  })
})
