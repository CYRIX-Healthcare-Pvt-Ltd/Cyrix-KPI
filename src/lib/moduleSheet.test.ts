import { describe, it, expect } from 'vitest'
import { describeModuleChange, moduleTemplateRows, readModuleRow } from './moduleSheet'

const MODULES = [
  { code: 'kpi', name: 'KPI' },
  { code: 'spare', name: 'Spare Mapping' },
  { code: 'bemmp', name: 'BEMMP Dashboard' },
  { code: 'pulse', name: 'Pulse' },
  { code: 'revive', name: 'Revive Lab' },
]

describe('the module sheet — every module, as people write them', () => {
  it('reads the template: Yes gives a module, No takes it away, blank leaves it as it is', () => {
    const row = { 'Employee Code': 'CT655', KPI: 'Yes', 'Spare Mapping': '', 'BEMMP Dashboard': null, Pulse: 'no', 'Revive Lab': '✓' }
    expect(readModuleRow(row, MODULES)).toEqual({ ecode: 'CT655', value: { give: ['kpi', 'revive'], take: ['pulse'] } })
  })

  it('gives Revive Lab and touches nothing else when that is all that is marked (the user, 29 Sep)', () => {
    const row = { 'Employee Code': 'E6666', KPI: '', 'Spare Mapping': '', 'BEMMP Dashboard': '', Pulse: '', 'Revive Lab': 'Yes' }
    const r = readModuleRow(row, MODULES)
    expect(r).toEqual({ ecode: 'E6666', value: { give: ['revive'], take: [] } })
    expect('value' in r && describeModuleChange(r.value, MODULES)).toBe('gives Revive Lab — the rest as they are')
  })

  it('changes nothing for a row with nothing marked', () => {
    const r = readModuleRow({ 'Employee Code': 'CT656', KPI: '', 'Spare Mapping': '', 'BEMMP Dashboard': '', Pulse: '', 'Revive Lab': '' }, MODULES)
    expect(r).toEqual({ ecode: 'CT656', value: { give: [], take: [] } })
    expect('value' in r && describeModuleChange(r.value, MODULES)).toBe('nothing marked — left as they are')
  })

  it('asks rather than guesses at a cell that is neither yes nor no', () => {
    expect(readModuleRow({ 'Employee Code': 'E4', KPI: 'maybe' }, MODULES))
      .toEqual({ ecode: 'E4', problem: expect.stringContaining('KPI "maybe"') })
  })

  it('still reads an older sheet, by code or by name, in any case — as the whole list', () => {
    expect(readModuleRow({ 'Employee Code': 'E1', Modules: 'kpi, Revive Lab, BEMMP dashboard' }, MODULES))
      .toEqual({ ecode: 'E1', value: { give: ['kpi', 'revive', 'bemmp'], take: ['spare', 'pulse'] } })
    expect(readModuleRow({ ecode: 'E2', modules: 'All' }, MODULES)).toEqual({ ecode: 'E2', value: { give: MODULES.map(m => m.code), take: [] } })
  })

  it('names the modules when one is not known', () => {
    const r = readModuleRow({ 'Employee Code': 'E3', Modules: 'kpi, payroll' }, MODULES)
    expect(r).toEqual({ ecode: 'E3', problem: expect.stringContaining('unknown module payroll') })
    expect('problem' in r && r.problem).toContain('Revive Lab')
  })

  it('gives a template with all five modules as columns, and it means what it shows', () => {
    const rows = moduleTemplateRows(MODULES)
    expect(Object.keys(rows[0])).toEqual(['Employee Code', 'KPI', 'Spare Mapping', 'BEMMP Dashboard', 'Pulse', 'Revive Lab'])
    expect(rows[2]).toMatchObject({ KPI: 'Yes', 'Spare Mapping': 'Yes', 'BEMMP Dashboard': 'Yes', Pulse: 'Yes', 'Revive Lab': 'Yes' })
    expect(readModuleRow(rows[1], MODULES)).toEqual({ ecode: 'CT656', value: { give: ['revive'], take: ['pulse'] } })
  })
})
