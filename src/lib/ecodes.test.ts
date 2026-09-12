import { describe, it, expect } from 'vitest'
import { parseEcodes } from './ecodes'

/**
 * Every case here is a real paste, and the second describe block exists
 * because the first version of this shipped with `[s,;|]+` instead of
 * `[\s,;|]+` — one lost backslash, which split the list on the letter
 * "s" and on nothing else. Three codes on two lines came out as two,
 * the second of them containing a newline, and the only reason it was
 * caught is that somebody typed a multi-line paste into the real screen.
 */
describe('parseEcodes — a pasted list, however it arrives', () => {
  it('takes commas', () => {
    expect(parseEcodes('E1234,CT616,FTC23')).toEqual(['E1234', 'CT616', 'FTC23'])
  })

  it('takes commas with spaces, which is what Excel gives', () => {
    expect(parseEcodes('E1234, CT616, FTC23')).toEqual(['E1234', 'CT616', 'FTC23'])
  })

  it('takes one per line', () => {
    expect(parseEcodes('E1234\nCT616\nFTC23')).toEqual(['E1234', 'CT616', 'FTC23'])
  })

  it('takes a mixture, with stray space at both ends', () => {
    expect(parseEcodes(' e1234 ,\tct616;\n\n FTC23 | e999  '))
      .toEqual(['E1234', 'CT616', 'FTC23', 'E999'])
  })

  it('upper-cases, because a code typed by hand is lower', () => {
    expect(parseEcodes('e1234, ct616')).toEqual(['E1234', 'CT616'])
  })

  it('collapses a list somebody pasted twice', () => {
    expect(parseEcodes('E1234, CT616, E1234')).toEqual(['E1234', 'CT616'])
  })

  it('has nothing to say about nothing', () => {
    expect(parseEcodes('')).toEqual([])
    expect(parseEcodes('   \n\t ')).toEqual([])
    expect(parseEcodes(',,,')).toEqual([])
  })

  it('keeps the prefix, which is what tells two people apart', () => {
    expect(parseEcodes('E616, CT616')).toEqual(['E616', 'CT616'])
  })
})

describe('parseEcodes — the lost backslash', () => {
  it('splits on whitespace, not on the letter s', () => {
    // The bug: "zz9999, ct665\n  e8888x" came back as two codes, the
    // second one "CT665\n  E8888X", because \s had become s.
    expect(parseEcodes('zz9999, ct665\n  e8888x'))
      .toEqual(['ZZ9999', 'CT665', 'E8888X'])
  })

  it('leaves an s inside a code alone', () => {
    expect(parseEcodes('ES12 SC44')).toEqual(['ES12', 'SC44'])
  })
})
