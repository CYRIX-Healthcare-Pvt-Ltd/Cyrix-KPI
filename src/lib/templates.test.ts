import { describe, it, expect } from 'vitest'
import { templateShape, findDuplicate, freeName } from './templates'

const row = (
  kra: string,
  weightage: number,
  extra: Partial<{ kpi_description: string | null; scoring_rule: string }> = {},
) => ({
  kra,
  kpi_description: extra.kpi_description ?? `${kra} description`,
  weightage,
  scoring_rule: extra.scoring_rule ?? 'higher_capped',
})

const ENGINEER = [
  row('Response time', 30),
  row('Closure rate', 30),
  row('Customer feedback', 20),
]

describe('templateShape', () => {
  it('ignores the order the rows were entered in', () => {
    expect(templateShape(ENGINEER)).toBe(templateShape([...ENGINEER].reverse()))
  })

  it('ignores case and stray whitespace', () => {
    const messy = [
      row('  RESPONSE   TIME ', 30, { kpi_description: 'Response Time DESCRIPTION' }),
      row('closure rate', 30, { kpi_description: 'closure rate description' }),
      row('Customer Feedback', 20, { kpi_description: 'Customer feedback description' }),
    ]
    expect(templateShape(messy)).toBe(templateShape(ENGINEER))
  })

  it('treats 25 and "25" as one weightage', () => {
    // The rows come back from PostgREST as numeric strings often enough
    // that a text comparison would report every saved template as
    // different from the draft it was saved from.
    const typed = [row('X', 25)]
    const fromServer = [{ ...row('X', 0), weightage: '25' as unknown as number }]
    expect(templateShape(typed)).toBe(templateShape(fromServer))
  })

  it('drops rows with no KRA — a blank line is not a difference', () => {
    expect(templateShape([...ENGINEER, row('   ', 0)])).toBe(templateShape(ENGINEER))
  })

  it('separates rows so two of them cannot be confused with one', () => {
    const split = [row('Response', 30), row('time', 30)]
    const joined = [row('Response time', 30)]
    expect(templateShape(split)).not.toBe(templateShape(joined))
  })
})

describe('findDuplicate', () => {
  const existing = [
    { id: 't1', name: 'Engineer', rows: ENGINEER },
    { id: 't2', name: 'Technician', rows: [row('Uptime', 80)] },
  ]

  it('finds the same rows under a different name', () => {
    const same = ENGINEER.map(r => ({ ...r }))
    expect(findDuplicate(same, existing)?.name).toBe('Engineer')
  })

  it('ignores the targets — the whole point of a template', () => {
    // Targets are not part of ComparableRow at all, so a row carrying a
    // different one is still the same shape. This is the behaviour the
    // rest of the feature depends on, so it is stated rather than assumed.
    const differentTargets = ENGINEER.map(r => ({ ...r, target_value: 999 }))
    expect(findDuplicate(differentTargets, existing)?.id).toBe('t1')
  })

  it('does not report a template as a duplicate of itself', () => {
    expect(findDuplicate(ENGINEER, existing, 't1')).toBeNull()
  })

  it('lets a real difference through', () => {
    const changed = [...ENGINEER.slice(1), row('Response time', 40)]
    expect(findDuplicate(changed, existing)).toBeNull()
  })

  it('says nothing about an empty draft', () => {
    expect(findDuplicate([], existing)).toBeNull()
    expect(findDuplicate([row('  ', 0)], existing)).toBeNull()
  })

  it('notices a changed scoring rule, which changes what the row means', () => {
    const rerouted = ENGINEER.map((r, i) =>
      i === 0 ? { ...r, scoring_rule: 'lower_better' } : r)
    expect(findDuplicate(rerouted, existing)).toBeNull()
  })
})

describe('freeName', () => {
  it('leaves a free name alone', () => {
    expect(freeName('Engineer', ['Technician'])).toBe('Engineer')
  })

  it('numbers a taken one', () => {
    expect(freeName('Engineer', ['Engineer'])).toBe('Engineer 2')
    expect(freeName('Engineer', ['Engineer', 'Engineer 2'])).toBe('Engineer 3')
  })

  it('matches the way the database compares names, not exactly', () => {
    // save_team_template collides on lower(btrim(name)), so a suggestion
    // that differs only in case or padding would be refused on save.
    expect(freeName('Engineer', ['  ENGINEER '])).toBe('Engineer 2')
  })

  it('falls back rather than returning an empty name', () => {
    expect(freeName('   ', [])).toBe('Team template')
  })
})
