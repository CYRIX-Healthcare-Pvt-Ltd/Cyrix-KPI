/**
 * One row of the module-access sheet, read the way people fill it in.
 *
 * The template has a column for each module — KPI, Spare Mapping, BEMMP
 * Dashboard, Pulse, Revive Lab. Yes gives a module, No takes it away, and
 * a blank cell leaves it as it is: a sheet written to give one person
 * Revive Lab took their KPI away when a blank meant "take it" (the user,
 * 29 Sep: "i mentioned yes and uploaded but why then kpi disabled?").
 *
 * An older sheet, every module in one Modules cell — by code or by name,
 * separated by commas, or "all" — still works, and is the whole list:
 * what it names is given, the rest taken away.
 */
import { hasColumn, isNo, isYes, looseKey, pick } from './sheet'

export interface ModuleLike {
  code: string
  name: string
}

/** What a row changes: modules to give, modules to take away; any other is left as it is. */
export interface ModuleChange {
  give: string[]
  take: string[]
}

export type ModuleRow = { ecode: string; value: ModuleChange } | { ecode: string; problem: string }

export function readModuleRow(row: Record<string, unknown>, modules: readonly ModuleLike[]): ModuleRow {
  const ecode = pick(row, 'employee_code', 'ecode', 'employee code', 'code', 'emp code')
  // The template's way: a column for each module.
  if (modules.some(m => hasColumn(row, m.name, m.code))) {
    const give: string[] = []
    const take: string[] = []
    const unclear: string[] = []
    for (const m of modules) {
      const cell = pick(row, m.name, m.code)
      if (!cell.trim()) continue
      if (isYes(cell)) give.push(m.code)
      else if (isNo(cell)) take.push(m.code)
      else unclear.push(`${m.name} "${cell}"`)
    }
    if (unclear.length > 0) {
      return { ecode, problem: `${unclear.join(', ')} — write Yes to give it, No to take it away, or leave it blank` }
    }
    return { ecode, value: { give, take } }
  }
  // The older way: all of them in one cell, the whole list.
  const wanted = pick(row, 'modules', 'module', 'access', 'tiles', 'apps')
    .split(/[,;/|]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const whole = (codes: string[]) => ({ give: codes, take: modules.map(m => m.code).filter(c => !codes.includes(c)) })
  if (wanted.some(w => looseKey(w) === 'all')) return { ecode, value: whole(modules.map(m => m.code)) }
  const found = wanted.map(w => ({ w, m: modules.find(m => looseKey(m.code) === looseKey(w) || looseKey(m.name) === looseKey(w)) }))
  const unknown = found.filter(f => !f.m).map(f => f.w)
  if (unknown.length > 0) {
    return { ecode, problem: `unknown module ${unknown.join(', ')} — the modules are ${modules.map(m => m.name).join(', ')}` }
  }
  // In this form a blank cell is a decision, not a gap: this person gets
  // nothing. The preview spells that out before it happens.
  return { ecode, value: whole([...new Set(found.map(f => f.m!.code))]) }
}

/** "Gives Revive Lab · takes away Pulse", or that nothing changes. */
export function describeModuleChange(c: ModuleChange, modules: readonly ModuleLike[]): string {
  const name = (code: string) => modules.find(m => m.code === code)?.name ?? code
  const parts = [
    c.give.length ? `gives ${c.give.map(name).join(', ')}` : '',
    c.take.length ? `takes away ${c.take.map(name).join(', ')}` : '',
  ].filter(Boolean)
  return parts.length ? `${parts.join(' · ')} — the rest as they are` : 'nothing marked — left as they are'
}

/** The template's rows: modules given, one taken away, the rest left blank — as they are. */
export function moduleTemplateRows(modules: readonly ModuleLike[]): Array<Record<string, string>> {
  const rows: Array<[string, Record<string, 'Yes' | 'No'>]> = [
    ['CT655', { kpi: 'Yes', spare: 'Yes' }],
    ['CT656', { revive: 'Yes', pulse: 'No' }],
    ['CT661', Object.fromEntries(modules.map(m => [m.code, 'Yes'])) as Record<string, 'Yes'>],
  ]
  return rows.map(([ecode, marks]) => ({
    'Employee Code': ecode,
    ...Object.fromEntries(modules.map(m => [m.name, marks[m.code] ?? ''])),
  }))
}
