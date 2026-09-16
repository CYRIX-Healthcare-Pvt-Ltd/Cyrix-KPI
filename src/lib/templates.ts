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

/**
 * A template's name, as it should read on screen.
 *
 * Names are typed by whoever made the template, and some were typed with
 * caps lock on: "DIVISIONAL MANAGER" beside "Biomedical Engineer" in one
 * list reads as two different kinds of thing, and was asked about as
 * exactly that. A name written entirely in capitals is shown in title
 * case. Words of three letters or fewer stay as they are, because those
 * are the acronyms — QA, MIS, HR, KPI — that are meant to be capitals.
 * Anything with a lower-case letter in it was typed that way on purpose
 * and is left alone.
 *
 * Display only. The stored name is never changed, and the person who
 * keeps the template renames it with Edit.
 */
export function displayTemplateName(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '')
  if (!letters || letters !== letters.toUpperCase()) return name
  // Nothing longer than an acronym: it is an acronym, or a code.
  if (!/[A-Z]{4,}/.test(name)) return name
  return name.replace(/[A-Z]+/g, w =>
    w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())
}

/** What a list needs to know to name a template that shares its name. */
export interface NameableTemplate {
  id: string
  name: string
  /** Yours to change. Yours is the one that keeps the plain name. */
  is_mine?: boolean
  /** HR's, which has no owner and is named for HR. */
  is_company?: boolean
  owner_name?: string | null
  owner_ecode?: string | null
}

/**
 * Names for a list in which two templates may be called the same thing.
 *
 * A manager below you can take their own version of a template your
 * people are on (0138), and it keeps the name — that is the point of it,
 * it is the same role. On your screen that is two "Specialist Engineer",
 * and which is which is the only thing anybody needs to know about them.
 *
 * So a name that clashes carries whoever keeps it: "Specialist Engineer
 * — Manish P (E1234)". Yours stays plain, because the list already
 * groups it under yours and tagging both sides says nothing the group
 * heading has not. A name nothing clashes with is never tagged at all,
 * which is what makes a merge visible: the two become one and the tag
 * goes away on its own.
 */
export function templateLabels(list: NameableTemplate[]): Map<string, string> {
  const seen = new Map<string, number>()
  for (const t of list) {
    const k = tidy(displayTemplateName(t.name))
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const out = new Map<string, string>()
  for (const t of list) {
    const shown = displayTemplateName(t.name)
    const clashes = (seen.get(tidy(shown)) ?? 0) > 1
    if (!clashes || t.is_mine) { out.set(t.id, shown); continue }
    const keeper = t.is_company
      ? 'HR'
      : [t.owner_name, t.owner_ecode ? `(${t.owner_ecode.toUpperCase()})` : null]
        .filter(Boolean).join(' ')
    out.set(t.id, keeper ? `${shown} — ${keeper}` : shown)
  }
  return out
}
