/**
 * Team KPI templates — what makes two of them the same one.
 *
 * A manager writing "Engineer" for the second time has not written a
 * second template, they have forgotten the first. The dropdown then
 * carries two entries with the same rows and different names, and the
 * next person to open it has to guess which one their manager meant.
 *
 * So a template is compared to the ones already there before it is
 * saved. Not on its name — the name is the part people vary — but on
 * what it actually measures.
 */

import type { ScoringRule, RuleParams } from './scoring'
import type { Alternate } from '@/types/db'

/** The parts of a row that decide what the row measures. */
export interface ComparableRow {
  kra: string
  kpi_description?: string | null
  weightage: number
  scoring_rule: string
}

const tidy = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * What a template measures, as one comparable string.
 *
 * Targets are deliberately excluded. They are the one thing a template
 * does not promise: an engineer in Kochi closing 90 calls and one in
 * Trivandrum closing 60 are on the same KPI, and treating them as two
 * templates is how a dropdown ends up with eleven "Engineer"s. The KRA,
 * the KPI wording, the weightage and the scoring rule are the shape, and
 * two templates with the same shape are the same template.
 *
 * Rows are sorted before joining, so the same eight KRAs entered in a
 * different order are still recognised. A manager who reorders a
 * template has not made a new one either.
 */
export function templateShape(rows: ComparableRow[]): string {
  return rows
    .filter(r => tidy(r.kra) !== '')
    .map(r => [
      tidy(r.kra),
      tidy(r.kpi_description),
      // A number, not its text: 25, 25.0 and "25" are one weightage.
      Number(r.weightage) || 0,
      tidy(r.scoring_rule),
    ].join('|'))
    .sort()
    .join('\n')
}

export interface TemplateLike {
  id: string
  name: string
  rows: ComparableRow[]
}

/**
 * The template these rows already are, if there is one.
 *
 * `exceptId` is the template being edited — saving a template over
 * itself must not report it as a duplicate of itself.
 *
 * Returns the match rather than a boolean, because "this is the same as
 * Engineer, which Afsal keeps" is an answer somebody can act on and
 * "duplicate" is not.
 */
export function findDuplicate(
  rows: ComparableRow[],
  existing: TemplateLike[],
  exceptId?: string | null,
): TemplateLike | null {
  const shape = templateShape(rows)
  if (shape === '') return null
  return existing.find(t => t.id !== exceptId && templateShape(t.rows) === shape) ?? null
}

/**
 * A name that is free, given the ones already taken.
 *
 * "Engineer" becomes "Engineer 2", then "Engineer 3". Used when a
 * template is saved from an approval, where the manager is offered a
 * name rather than asked for one — and being offered a name the server
 * will refuse is worse than being offered nothing.
 */
export function freeName(wanted: string, taken: string[]): string {
  const used = new Set(taken.map(t => tidy(t)))
  const base = wanted.trim() || 'Team template'
  if (!used.has(tidy(base))) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} ${n}`
    if (!used.has(tidy(candidate))) return candidate
  }
  return `${base} ${Date.now()}`
}

/**
 * A row as the save_team_template function wants it.
 *
 * Alternatives ride along: a template row becomes an assignment row, and
 * one that arrives without them is a KPI missing the half of itself that
 * only applies in some months.
 */
export interface TemplateRowInput {
  kra: string
  kpi_description: string | null
  weightage: number
  target_value: number | null
  target_unit: string | null
  scoring_rule: ScoringRule
  rule_params: RuleParams
  alternates: Alternate[]
}
