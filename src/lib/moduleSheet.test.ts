import { describe, it, expect } from 'vitest'
import { moduleTemplateRows, readModuleRow } from './moduleSheet'

const MODULES = [
  { code: 'kpi', name: 'KPI' },
  { code: 'spare', name: 'Spare Mapping' },
  { code: 'bemmp', name: 'BEMMP Dashboard' },
  { code: 'pulse', name: 'Pulse' },
  { code: 'revive', name: 'Revive Lab' },
]

describe('the module sheet — every module, as people write them', () => {
  it('reads the template: a column for each module, Yes where they should have it', () => {
    const row = { 'Employee Code': 'CT655', KPI: 'Yes', 'Spare Mapping': '', 'BEMMP Dashboard': null, Pulse: 'y', 'Revive Lab': '✓' }
    expect(readModuleRow(row, MODULES)).toEqual({ ecode: 'CT655', value: ['kpi', 'pulse', 'revive'] })
  })

  it('takes every tile away from a row with none marked', () => {
    const row = { 'Employee Code': 'CT656', KPI: '', 'Spare Mapping': '', 'BEMMP Dashboard': '', Pulse: '', 'Revive Lab': '' }
    expect(readModuleRow(row, MODULES)).toEqual({ ecode: 'CT656', value: [] })
  })

  it('still reads an older sheet, by code or by name, in any case', () => {
    expect(readModuleRow({ 'Employee Code': 'E1', Modules: 'kpi, Revive Lab, BEMMP dashboard, pulse, spare mapping' }, MODULES))
      .toEqual({ ecode: 'E1', value: ['kpi', 'revive', 'bemmp', 'pulse', 'spare'] })
    expect(readModuleRow({ ecode: 'E2', modules: 'All' }, MODULES)).toEqual({ ecode: 'E2', value: MODULES.map(m => m.code) })
  })

  it('names the modules when one is not known', () => {
    const r = readModuleRow({ 'Employee Code': 'E3', Modules: 'kpi, payroll' }, MODULES)
    expect(r).toEqual({ ecode: 'E3', problem: expect.stringContaining('unknown module payroll') })
    expect('problem' in r && r.problem).toContain('Revive Lab')
  })

  it('gives a template with all five modules as columns', () => {
    const rows = moduleTemplateRows(MODULES)
    expect(Object.keys(rows[0])).toEqual(['Employee Code', 'KPI', 'Spare Mapping', 'BEMMP Dashboard', 'Pulse', 'Revive Lab'])
    expect(rows[2]).toMatchObject({ KPI: 'Yes', 'Spare Mapping': 'Yes', 'BEMMP Dashboard': 'Yes', Pulse: 'Yes', 'Revive Lab': 'Yes' })
    // Read back, the template means what it shows.
    expect(readModuleRow(rows[1], MODULES)).toEqual({ ecode: 'CT656', value: ['kpi', 'revive'] })
  })
})
