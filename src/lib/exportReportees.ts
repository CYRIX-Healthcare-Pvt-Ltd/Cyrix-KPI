import type { CoreValueDefinition, Employee, KpiSubmission, KpiSubmissionItem } from '@/types/db'
import { supabase } from './supabase'
import { ratingToPoints } from './scoring'
import { exportData } from './export'
import { monthLabel } from './fy'

/*
  Reportee-wise KPI export (the user, 14 Oct): one workbook per person in a zip, named
  "<ecode> <name>.xlsx". Sheet 1 is the KPIs the year started with: KRA, KPI, weightage, then each
  month's target, achieved, achievement % and score. A KPI that changed or was added later in the
  year goes on sheet 2, "Changed KPIs", so the two sets are never mixed in one table.
*/

const SECTION = { job_role: 'Job role', esms: 'ESMS', core_values: 'Core values' } as const
const key = (i: KpiRowDefinitionLike) => `${i.section}|${i.kra.trim().toLowerCase()}|${(i.kpi_description ?? '').trim().toLowerCase()}`
type KpiRowDefinitionLike = Pick<KpiSubmissionItem, 'section' | 'kra' | 'kpi_description'>

const r2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100)

export async function exportReporteesZip(people: Employee[], fy: string, filename: string) {
  // ExcelJS, not SheetJS: the community SheetJS writes no colours or borders (the user, 14 Oct: "good format").
  const [{ default: ExcelJS }, { zipSync }] = await Promise.all([import('exceljs'), import('fflate')])
  // Through kpi_export_data (0218), which reaches the whole line: a table read stops at direct reports and
  // left everyone further down with an empty workbook (the user, 22 Oct).
  const data = await exportData(people.map(p => p.id), fy)
  const subs = data.submissions
  const items = data.items

  const itemsBySub = new Map<string, KpiSubmissionItem[]>()
  for (const it of items) itemsBySub.set(it.submission_id, [...(itemsBySub.get(it.submission_id) ?? []), it])

  /*
    A KPI that splits its core values (0214) gets one row per core value instead of the single core
    values row (the user, 17 Oct): its weight, the rating as points out of 100 (target 100), and the
    score that rating earns of the weight. The manager's rating once scored, the team member's before.
  */
  const assignmentIds = [...new Set(subs.map(s => s.assignment_id))]
  const splits = data.assignments.filter(a => assignmentIds.includes(a.id))
  const weightsOf = new Map(splits.filter(a => a.core_self_rating && a.core_value_weights).map(a => [a.id, a.core_value_weights!]))
  const splitSubs = subs.filter(s => weightsOf.has(s.assignment_id))
  if (splitSubs.length) {
    const { data: defs, error: defError } = await supabase.from('core_value_definitions').select('*').eq('is_active', true).order('sort_order')
    if (defError) throw new Error(defError.message)
    const ratings = data.ratings
    for (const s of splitSubs) {
      const weights = weightsOf.get(s.assignment_id)!
      const own = itemsBySub.get(s.id) ?? []
      const core = own.find(i => i.section === 'core_values')
      const at = (core?.sort_order ?? 9000)
      const rows = ((defs ?? []) as CoreValueDefinition[]).map((cv, n) => {
        const r = ratings.find(x => x.submission_id === s.id && x.core_value_id === cv.id)
        const self = ratingToPoints(r?.self_rating), mgr = ratingToPoints(r?.manager_rating)
        const w = Number(weights[cv.id] ?? 0)
        const pts = mgr ?? self
        return {
          ...(core ?? {}), id: `${s.id}-${cv.id}`, submission_id: s.id, section: 'core_values',
          kra: cv.name, kpi_description: cv.description ?? '', weightage: w, scoring_rule: 'rating_scale',
          target_value: 100, self_achieved: self, manager_achieved: mgr,
          final_score: pts === null ? null : (pts * w) / 100, manager_score: null, self_score: null,
          sort_order: at + n / 100,
        } as unknown as KpiSubmissionItem
      })
      itemsBySub.set(s.id, [...own.filter(i => i.section !== 'core_values'), ...rows].sort((a, b) => a.sort_order - b.sort_order))
    }
  }

  const files: Record<string, Uint8Array> = {}
  for (const person of people) {
    const mine = subs.filter(s => s.employee_id === person.id).sort((a, b) => a.period_month.localeCompare(b.period_month))
    const wb = new ExcelJS.Workbook()
    if (!mine.length) {
      const ws = wb.addWorksheet('KPI')
      ws.addRow([`${person.ecode} · ${person.full_name}`]).font = { bold: true, name: 'Calibri', size: 10 }
      ws.addRow(['No KPI filed in ' + fy])
    } else {
      const months = mine.map(s => s.period_month)
      // The year's first set of KPIs; anything not in it is a change.
      const first = new Set((itemsBySub.get(mine[0].id) ?? []).map(key))
      const rows = new Map<string, { def: KpiSubmissionItem; byMonth: Map<string, KpiSubmissionItem> }>()
      for (const s of mine) for (const it of itemsBySub.get(s.id) ?? []) {
        const k = key(it)
        const row = rows.get(k) ?? { def: it, byMonth: new Map() }
        row.byMonth.set(s.period_month, it)
        rows.set(k, row)
      }
      const sheet = (wsName: string, list: typeof rows extends Map<string, infer V> ? V[] : never, withTotals: boolean) => {
        const head1: (string | null)[] = [`${person.ecode} · ${person.full_name}`, null, null, null]
        const head2: (string | null)[] = ['Section', 'KRA', 'KPI', 'Weightage %']
        for (const m of months) { head1.push(monthLabel(m), null, null, null, null); head2.push('Target', 'Achieved', 'Achievement %', 'Score', 'Actual score') }
        const body = list.map(({ def, byMonth }) => {
          const line: (string | number | null)[] = [SECTION[def.section] ?? def.section, def.kra, def.kpi_description ?? '', r2(def.weightage)]
          for (const m of months) {
            const it = byMonth.get(m)
            const target = it?.target_value ?? null
            const achieved = it ? it.manager_achieved ?? it.self_achieved : null
            /*
              Achievement the right way round (the user, 16 Oct): on a Lower is better row, coming in under
              the target is the achievement, so it is target / achieved; 112.3 against 100 is 89%, not 112%.
              Actual score, after the score, is that share of the weightage with no cap: 200 against a target of 100 on a 40% row
              is 80%, beside the score, which stops at the row's 40.
            */
            const lower = String(it?.scoring_rule ?? def.scoring_rule).startsWith('lower')
            const pct = target && achieved !== null
              ? r2(lower ? (achieved > 0 ? (target / achieved) * 100 : 100) : (achieved / target) * 100)
              : null
            const score = r2(it ? it.final_score ?? it.manager_score ?? it.self_score : null)
            // No achievement to scale (a target of 0, say): the score itself.
            const actual = pct !== null ? r2((pct * Number(it?.weightage ?? def.weightage)) / 100) : score
            line.push(r2(target), r2(achieved), pct, score, actual)
          }
          return line
        })
        const totals: (string | number | null)[][] = []
        if (withTotals) {
          const bySub = new Map(mine.map(s => [s.period_month, s]))
          // Each total row also adds up its rows' Actual score (the user, 16 Oct); Total adds them all.
          const line = (label: string, pick: (s: KpiSubmission) => number | null, section?: string) => {
            const l: (string | number | null)[] = [label, null, null, null]
            months.forEach((m, k) => {
              const s = bySub.get(m)!
              const col = 4 + k * 5 + 4
              const rows = body.filter(b => !section || b[0] === section)
              const sum = rows.reduce((t, b) => t + (typeof b[col] === 'number' ? (b[col] as number) : 0), 0)
              l.push(null, null, null, r2(pick(s)), rows.length ? r2(sum) : null)
            })
            totals.push(l)
          }
          totals.push([])
          line('Job role %', s => s.final_job_role_score ?? s.mgr_job_role_score ?? s.self_job_role_score, 'Job role')
          if (mine.some(s => (s.final_esms_score ?? s.self_esms_score) !== null)) line('ESMS %', s => s.final_esms_score ?? s.mgr_esms_score ?? s.self_esms_score, 'ESMS')
          line('Core values %', s => s.final_core_score ?? s.mgr_core_score ?? s.self_core_score, 'Core values')
          line('Total', s => s.final_total_score ?? s.mgr_total_score ?? s.self_total_score)
        }
        const ws = wb.addWorksheet(wsName, { views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }] })
        const last = 4 + months.length * 5
        const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
        const thin = { style: 'thin' as const, color: { argb: 'FF000000' } }
        const grid = { top: thin, left: thin, bottom: thin, right: thin }
        ws.addRow(head1); ws.addRow(head2)
        ws.mergeCells(1, 1, 1, 4)
        months.forEach((_, i) => ws.mergeCells(1, 5 + i * 5, 1, 9 + i * 5))
        // Title and month bands: the year's months alternate two blues so each block reads as one.
        for (let c = 1; c <= last; c++) {
          const band = c <= 4 ? 'FF1E293B' : Math.floor((c - 5) / 5) % 2 ? 'FF2563EB' : 'FF1D4ED8'
          const top = ws.getCell(1, c)
          top.fill = fill(band); top.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: c <= 4 ? 12 : 11 }
          top.alignment = { horizontal: c <= 4 ? 'left' : 'center', vertical: 'middle' }; top.border = grid
          const sub = ws.getCell(2, c)
          // Actual score's heading a shade darker, so it reads apart from Score (the user, 16 Oct).
          sub.fill = fill(c > 4 && (c - 5) % 5 === 4 ? 'FFBFDBFE' : 'FFDBEAFE'); sub.font = { bold: true, color: { argb: 'FF1E3A8A' } }
          sub.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; sub.border = grid
        }
        ws.getRow(1).height = 22; ws.getRow(2).height = 30
        body.forEach((line, i) => {
          const row = ws.addRow(line)
          row.eachCell({ includeEmpty: true }, (cell, c) => {
            if (c > last) return
            cell.border = grid
            cell.alignment = { vertical: 'middle', wrapText: c <= 3, horizontal: c <= 3 ? 'left' : 'center' }
            if (i % 2) cell.fill = fill('FFF8FAFC')
            // Score and Actual score to two places, as on screen (the user, 16 Oct).
            if (c > 4 && (c - 5) % 5 >= 3 && typeof cell.value === 'number') cell.numFmt = '0.00'
            if (c > 4 && (c - 5) % 5 === 2 && typeof cell.value === 'number') {
              cell.numFmt = '0.0"%"'
              // Achievement: green at target, amber close, red well short.
              cell.font = { bold: true, color: { argb: cell.value >= 100 ? 'FF15803D' : cell.value >= 75 ? 'FFB45309' : 'FFB91C1C' } }
            }
          })
        })
        for (const line of totals) {
          const row = ws.addRow(line)
          if (!line.length) continue
          const isTotal = line[0] === 'Total'
          row.eachCell({ includeEmpty: true }, (cell, c) => {
            if (c > last) return
            cell.font = { bold: true }
            cell.fill = fill(isTotal ? 'FFDCFCE7' : 'FFF1F5F9')
            if (c > 4 && typeof cell.value === 'number') cell.numFmt = '0.00'
            cell.border = grid
            cell.alignment = { vertical: 'middle', horizontal: c <= 4 ? 'left' : 'center' }
          })
          ws.mergeCells(row.number, 1, row.number, 4)
        }
        // Calibri 10 throughout (the user, 14 Oct).
        ws.eachRow({ includeEmpty: true }, r => r.eachCell({ includeEmpty: true }, cell => { cell.font = { ...cell.font, name: 'Calibri', size: 10 } }))
        ws.columns = [{ width: 13 }, { width: 30 }, { width: 46 }, { width: 12 }, ...months.flatMap(() => [{ width: 10 }, { width: 11 }, { width: 14 }, { width: 9 }, { width: 11 }])]
      }
      const all = [...rows.entries()]
      sheet('KPI', all.filter(([k]) => first.has(k)).map(([, v]) => v), true)
      const changed = all.filter(([k]) => !first.has(k)).map(([, v]) => v)
      if (changed.length) sheet('Changed KPIs', changed, false)
    }
    const name = `${person.ecode} ${person.full_name}`.replace(/[\\/:*?"<>|]+/g, ' ').trim()
    files[`${name}.xlsx`] = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
  }
  const blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
