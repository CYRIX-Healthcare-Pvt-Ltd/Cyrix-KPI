import type { KpiAssignment, KpiRowDefinition, Section } from '@/types/db'

/**
 * What a section is called and what it is worth.
 *
 * Five screens each carried their own `['job_role', 'core_values']` with
 * their own labels and their own `section === 'job_role' ? 80 : 20`.
 * Adding a third band to five copies of the same list is how one of them
 * ends up quietly not showing ESMS at all.
 *
 * The weights here are the defaults for display before an assignment has
 * been loaded. Where the real assignment is in hand, prefer
 * sectionsOf() — the split is per person, and 15 or 20 for core values
 * is exactly the thing that varies.
 */

export const SECTION_ORDER: Section[] = ['job_role', 'esms', 'core_values']

export const SECTION_LABEL: Record<Section, string> = {
  job_role: 'Job Role',
  esms: 'ESMS',
  core_values: 'Alignment To Core Values',
}

/** Short enough for a table header or a chip. */
export const SECTION_SHORT: Record<Section, string> = {
  job_role: 'Job role',
  esms: 'ESMS',
  core_values: 'Core values',
}

export const JOB_ROLE_TOTAL = 80
/** Job role aside, this is what is left to divide up. */
export const REMAINDER_TOTAL = 20
export const ESMS_WEIGHT = 5

export interface SectionSplit {
  key: Section
  label: string
  short: string
  weight: number
  /** True for the bands the system stamps on rather than the person writing. */
  standard: boolean
}

/**
 * The sections this particular KPI actually has, in reading order.
 *
 * ESMS is omitted entirely when its weight is zero, so a person who does
 * not carry it never sees an empty band explaining that they do not.
 */
export function sectionsOf(
  a: Pick<KpiAssignment, 'job_role_weight' | 'core_values_weight' | 'esms_weight'>
    | null | undefined,
): SectionSplit[] {
  const esms = Number(a?.esms_weight ?? 0)
  const core = Number(a?.core_values_weight ?? REMAINDER_TOTAL - esms)

  return [
    {
      key: 'job_role', label: SECTION_LABEL.job_role, short: SECTION_SHORT.job_role,
      weight: Number(a?.job_role_weight ?? JOB_ROLE_TOTAL), standard: false,
    },
    ...(esms > 0 ? [{
      key: 'esms' as const, label: SECTION_LABEL.esms, short: SECTION_SHORT.esms,
      weight: esms, standard: true,
    }] : []),
    {
      key: 'core_values', label: SECTION_LABEL.core_values, short: SECTION_SHORT.core_values,
      weight: core, standard: true,
    },
  ]
}

/** Does this set of rows carry an ESMS row? */
export const hasEsms = (rows: Pick<KpiRowDefinition, 'section'>[]) =>
  rows.some(r => r.section === 'esms')
