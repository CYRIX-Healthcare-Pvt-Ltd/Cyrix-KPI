import { describe, it, expect } from 'vitest'
import { pick, bigDeactivation } from './sheet'
import { normaliseRole, saysAdmin, SPARE_ROLES } from './spareRoles'

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
  it('knows each of the three however it is written', () => {
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
    ] as const) {
      expect(normaliseRole(raw)).toBe(expected)
    }
  })

  it('does not treat admin as a role, because it is not one', () => {
    // Administering is something people also do (migration 0069), so it
    // arrives on its own flag. A sheet saying "Admin" in the role column
    // is missing the actual job and must be refused rather than guessed.
    expect(normaliseRole('Admin')).toBeNull()
    expect(normaliseRole('Administrator')).toBeNull()
  })

  it('refuses a word it does not know rather than guessing one', () => {
    // The dangerous version of this returns 'engineer' for anything
    // unrecognised: the upload then reports success while handing
    // somebody a role from a typo.
    for (const raw of ['supervisor', 'store keeper', 'xyz', '', '   ']) {
      expect(normaliseRole(raw)).toBeNull()
    }
  })

  it('reads "also an admin" from either column, or from neither', () => {
    // A separate Admin column…
    for (const yes of ['Yes', 'y', 'TRUE', '1', 'Admin']) expect(saysAdmin(yes)).toBe(true)
    // …or squeezed into the role cell, which is what people do when
    // there is no Admin column to put it in.
    expect(saysAdmin('Project manager, Admin')).toBe(true)
    expect(saysAdmin('Engineer + administrator')).toBe(true)

    for (const no of ['', '   ', 'No', 'false', '0', 'Engineer', 'Purchase']) {
      expect(saysAdmin(no)).toBe(false)
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

describe('bigDeactivation', () => {
  it('waves through an ordinary month of leavers', () => {
    // Twelve out of 1151 is a normal month. Stopping for it would train
    // people to type the number without reading it.
    expect(bigDeactivation(12, 1151)).toBe(false)
    expect(bigDeactivation(0, 1151)).toBe(false)
  })

  it('stops the partial file that would empty the company', () => {
    // The case this exists for: a 50-row correction sheet against 1151.
    expect(bigDeactivation(1101, 1151)).toBe(true)
    expect(bigDeactivation(200, 1151)).toBe(true)
  })

  it('needs both a big share and a real number, not either', () => {
    // Two of eight is a quarter of a small team and not worth a dialog.
    expect(bigDeactivation(2, 8)).toBe(false)
    // Fifty is a lot of people but a twentieth of the company — the file
    // still looks like a master, so this is a real round of leavers.
    expect(bigDeactivation(50, 1151)).toBe(false)
    // Ten out of forty is both.
    expect(bigDeactivation(10, 40)).toBe(true)
  })

  it('does not divide by a headcount it was never given', () => {
    // If the active count failed to load it must not read as "everyone
    // is leaving" and block a legitimate import behind a 0 to type.
    expect(bigDeactivation(5, 0)).toBe(false)
    expect(bigDeactivation(10, 0)).toBe(true)
  })
})
