import { describe, it, expect } from 'vitest'
import { daysWaiting, waitingLabel, turnaroundLabel } from './tat'

const NOW = Date.parse('2026-09-16T10:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOURS = 3_600_000
const DAYS = 86_400_000

describe('daysWaiting', () => {
  it('counts whole days only', () => {
    expect(daysWaiting(ago(23 * HOURS), NOW)).toBe(0)
    expect(daysWaiting(ago(25 * HOURS), NOW)).toBe(1)
    expect(daysWaiting(ago(5 * DAYS), NOW)).toBe(5)
  })

  it('never goes negative when a clock is ahead', () => {
    expect(daysWaiting(new Date(NOW + 3 * DAYS).toISOString(), NOW)).toBe(0)
  })

  it('reads a date the database sent as a plain day', () => {
    expect(daysWaiting('2026-09-11', NOW)).toBe(5)
  })

  it('says nothing about a value that is not a time', () => {
    expect(daysWaiting('not a date', NOW)).toBe(0)
  })
})

describe('waitingLabel — a day is the line', () => {
  it('is calm under a day', () => {
    expect(waitingLabel(ago(20 * HOURS), NOW)).toMatchObject({ tone: 'ok', text: 'Waiting 20 hours' })
    expect(waitingLabel(ago(HOURS), NOW).text).toBe('Waiting 1 hour')
    expect(waitingLabel(ago(60_000), NOW).text).toBe('Waiting under an hour')
  })

  it('warns at a day — the same line the reminder mail chases on', () => {
    expect(waitingLabel(ago(DAYS), NOW)).toMatchObject({ tone: 'warn', days: 1, text: 'Waiting 1 day' })
  })

  it('reads as late from two days', () => {
    expect(waitingLabel(ago(2 * DAYS), NOW)).toMatchObject({ tone: 'late', text: 'Waiting 2 days' })
    expect(waitingLabel(ago(9 * DAYS), NOW).text).toBe('Waiting 9 days')
  })
})

describe('turnaroundLabel — what it took', () => {
  it('counts from raised to answered', () => {
    expect(turnaroundLabel(ago(3 * DAYS), ago(DAYS))).toBe('Answered in 2 days')
    expect(turnaroundLabel(ago(3 * HOURS), ago(HOURS))).toBe('Answered in 2 hours')
  })

  it('does not say "0 days" for something answered straight away', () => {
    expect(turnaroundLabel(ago(10 * 60_000), ago(0))).toBe('Answered the same hour')
  })

  it('says nothing at all when it is not answered yet', () => {
    expect(turnaroundLabel(ago(DAYS), null)).toBe('')
  })
})
