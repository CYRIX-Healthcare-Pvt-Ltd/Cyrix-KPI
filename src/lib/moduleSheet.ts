/**
 * One row of the module-access sheet, read the way people fill it in.
 *
 * The template has a column for each module — KPI, Spare Mapping, BEMMP
 * Dashboard, Pulse, Revive Lab — with Yes under the ones a person should
 * have. It showed three codes before and left the rest to be guessed, and
 * a sheet naming "Revive Lab" came back as an unknown module (the user,
 * 23 Sep: "on bulk assign, these all modules cannot be done"). An older
 * sheet, every module in one Modules cell, still works — by code or by
 * name, separated by commas, or "all".
 */
import { hasColumn, isYes, looseKey, pick } from './sheet'

export interface ModuleLike {
  code: string
  name: string
}

export type ModuleRow = { ecode: string; value: string[] } | { ecode: string; problem: string }

export function readModuleRow(row: Record<string, unknown>, modules: readonly ModuleLike[]): ModuleRow {
  const ecode = pick(row, 'employee_code', 'ecode', 'employee code', 'code', 'emp code')
  // The template's way: a column for each module, Yes where they should have it.
  if (modules.some(m => hasColumn(row, m.name, m.code))) {
    return { ecode, value: modules.filter(m => isYes(pick(row, m.name, m.code))).map(m => m.code) }
  }
  // The older way: all of them in one cell.
  const wanted = pick(row, 'modules', 'module', 'access', 'tiles', 'apps')
    .split(/[,;/|]+/)
    .map(s => s.trim())
    .filter(Boolean)
  if (wanted.some(w => looseKey(w) === 'all')) return { ecode, value: modules.map(m => m.code) }
  const found = wanted.map(w => ({ w, m: modules.find(m => looseKey(m.code) === looseKey(w) || looseKey(m.name) === looseKey(w)) }))
  const unknown = found.filter(f => !f.m).map(f => f.w)
  if (unknown.length > 0) {
    return { ecode, problem: `unknown module ${unknown.join(', ')} — the modules are ${modules.map(m => m.name).join(', ')}` }
  }
  // A blank cell is a decision, not a gap: it says this person gets
  // nothing. The preview spells that out before it happens.
  return { ecode, value: [...new Set(found.map(f => f.m!.code))] }
}

/** The template's rows: one person with a few modules, one with another few, one with all of them. */
export function moduleTemplateRows(modules: readonly ModuleLike[]): Array<Record<string, string>> {
  const rows: Array<[string, string[]]> = [
    ['CT655', ['kpi', 'spare']],
    ['CT656', ['kpi', 'revive']],
    ['CT661', modules.map(m => m.code)],
  ]
  return rows.map(([ecode, codes]) => ({
    'Employee Code': ecode,
    ...Object.fromEntries(modules.map(m => [m.name, codes.includes(m.code) ? 'Yes' : ''])),
  }))
}
