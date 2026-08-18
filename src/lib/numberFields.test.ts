import { describe, it, expect } from 'vitest'
import { wheelWouldEdit } from './numberFields'

/**
 * The reported bug: filling in the KPI form, scrolling to the next row,
 * and finding the weightage you just typed has changed on the way past.
 *
 * A focused input[type=number] takes the wheel as up/down. The guard has
 * to fire on exactly that overlap and nothing else — every other scroll
 * on the page must be left alone, or the form starts dropping focus for
 * no reason the person can see.
 */
describe('when a scroll would edit a number field', () => {
  const numberField = { tagName: 'INPUT', type: 'number' }

  it('fires when the focused number field is the one under the pointer', () => {
    expect(wheelWouldEdit(numberField, numberField)).toBe(true)
  })

  it('leaves a number field that is focused but not scrolled over', () => {
    // Scrolling the page while a field holds focus is the normal case.
    expect(wheelWouldEdit(numberField, { tagName: 'DIV' })).toBe(false)
  })

  it('leaves a number field under the pointer that is not focused', () => {
    expect(wheelWouldEdit(null, numberField)).toBe(false)
    expect(wheelWouldEdit({ tagName: 'BODY' }, numberField)).toBe(false)
  })

  it('leaves every other kind of field alone', () => {
    for (const type of ['text', 'date', 'month', 'password', 'checkbox', 'file']) {
      const el = { tagName: 'INPUT', type }
      expect(wheelWouldEdit(el, el)).toBe(false)
    }
    for (const tagName of ['TEXTAREA', 'SELECT', 'DIV', 'BODY']) {
      const el = { tagName, type: 'number' }
      expect(wheelWouldEdit(el, el)).toBe(false)
    }
  })

  it('survives a page with nothing focused', () => {
    expect(wheelWouldEdit(null, null)).toBe(false)
    expect(wheelWouldEdit(undefined, undefined)).toBe(false)
  })
})
