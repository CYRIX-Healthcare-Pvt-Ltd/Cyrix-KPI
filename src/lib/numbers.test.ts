import { describe, it, expect } from 'vitest'
import { cleanNumberText } from '@/components/ui'

/**
 * The reported bug: a weightage field showing "040".
 *
 * These fields start at 0 and people type after it, so the zero stays in
 * front. React normally corrects a controlled input's displayed text —
 * but not for type="number", where its check is `node.value != value`,
 * and "040" loosely equals 40. So it never notices, and the odd string
 * sits there.
 *
 * The rule has to be narrow. Anything that reaches further eats the "4."
 * somebody is halfway through typing as "4.5", which is a worse bug than
 * the one being fixed because it happens while they are looking at it.
 */
describe('leading zeros', () => {
  it('drops zeros that have a digit behind them', () => {
    expect(cleanNumberText('040')).toBe('40')
    expect(cleanNumberText('004')).toBe('4')
    expect(cleanNumberText('08')).toBe('8')
    expect(cleanNumberText('0100')).toBe('100')
  })

  it('leaves a lone zero alone', () => {
    expect(cleanNumberText('0')).toBe('0')
    expect(cleanNumberText('')).toBe('')
  })

  it('does not touch a decimal point', () => {
    expect(cleanNumberText('0.5')).toBe('0.5')
    expect(cleanNumberText('0.05')).toBe('0.05')
    // Mid-typing: "4." must survive so ".5" can still be typed after it.
    expect(cleanNumberText('4.')).toBe('4.')
    expect(cleanNumberText('0.')).toBe('0.')
  })

  it('keeps a minus sign in front', () => {
    expect(cleanNumberText('-05')).toBe('-5')
    expect(cleanNumberText('-0')).toBe('-0')
    expect(cleanNumberText('-0.5')).toBe('-0.5')
  })

  it('leaves an already-clean number untouched', () => {
    for (const n of ['40', '4', '100', '12.5', '-3']) {
      expect(cleanNumberText(n)).toBe(n)
    }
  })

  it('never changes what the number means', () => {
    for (const raw of ['040', '004', '0.5', '4.', '-05', '0', '100']) {
      const cleaned = cleanNumberText(raw)
      // Both parse to the same value, or both to NaN — the display
      // changes, the figure never does.
      const a = Number(raw)
      const b = Number(cleaned)
      expect(Number.isNaN(a) ? Number.isNaN(b) : a === b).toBe(true)
    }
  })
})
