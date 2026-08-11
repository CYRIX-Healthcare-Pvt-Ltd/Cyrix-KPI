import { describe, it, expect } from 'vitest'
import {
  bandFor, attainmentPct, BAND_SCALE, bandScaleGradient, teamBandShare,
} from './bands'

/**
 * A score below the total is out of its own weightage, and the band has
 * to come from the share earned rather than the raw figure.
 *
 * Every case here is one that was actually on screen and wrong: a KRA
 * worth 20 that earned all 20 was painted the same red as a genuine
 * 20/100, and a core-values band at 16 of 20 — a Very Good month — was
 * called Poor.
 */
const bandOf = (score: number, outOf: number) =>
  bandFor(attainmentPct(score, outOf))?.label

describe('a score is banded on its share, not its size', () => {
  it('calls a full row Excellent whatever the row is worth', () => {
    expect(bandOf(20, 20)).toBe('Excellent')
    expect(bandOf(50, 50)).toBe('Excellent')
    expect(bandOf(10, 10)).toBe('Excellent')
    expect(bandOf(80, 80)).toBe('Excellent')
  })

  it('bands the core-values block against its own weightage', () => {
    // 20-point band: the standard split.
    expect(bandOf(16, 20)).toBe('Very Good')
    expect(bandOf(12, 20)).toBe('Good')
    expect(bandOf(7, 20)).toBe('Poor')
    // 15-point band: the people who also carry ESMS.
    expect(bandOf(12, 15)).toBe('Very Good')
    expect(bandOf(14, 15)).toBe('Excellent')
  })

  it('ranks 14 of 15 above 16 of 20, which the raw scores reverse', () => {
    const a = attainmentPct(14, 15)!
    const b = attainmentPct(16, 20)!
    expect(a).toBeGreaterThan(b)
    expect(14).toBeLessThan(16)
  })

  it('bands a job role out of 80 on the percentage', () => {
    expect(bandOf(70, 80)).toBe('Very Good')   // 87.5%
    expect(bandOf(60, 80)).toBe('Good')        // 75%
    expect(bandOf(40, 80)).toBe('Satisfactory') // 50%
  })

  it('leaves a total out of 100 exactly as it was', () => {
    expect(bandOf(85, 100)).toBe(bandFor(85)?.label)
    expect(bandOf(16, 100)).toBe('Poor')
  })

  it('has no band for an unscored row, rather than a zero one', () => {
    expect(attainmentPct(null, 20)).toBeNull()
    // A weightage of zero is a band this person does not carry.
    expect(attainmentPct(5, 0)).toBeNull()
  })
})

describe('the band scale the meter draws', () => {
  it('runs 0 to 100 with no gaps and no overlaps', () => {
    expect(BAND_SCALE[0].from).toBe(0)
    expect(BAND_SCALE[BAND_SCALE.length - 1].to).toBe(100)
    for (let i = 1; i < BAND_SCALE.length; i++) {
      expect(BAND_SCALE[i].from).toBe(BAND_SCALE[i - 1].to)
    }
  })

  it('goes poor to excellent, in that order', () => {
    expect(BAND_SCALE.map(s => s.band.key)).toEqual([
      'poor', 'satisfactory', 'good', 'veryGood', 'excellent',
    ])
  })

  it('puts each band boundary where bandFor agrees it is', () => {
    for (const { band, from, to } of BAND_SCALE) {
      expect(bandFor(from)?.key).toBe(band.key)
      expect(bandFor(to - 0.01)?.key).toBe(band.key)
    }
  })

  it('builds a gradient with a hard stop at every boundary', () => {
    const g = bandScaleGradient()
    // Two stops per band — one to open it, one to close it — so the
    // colour does not smear across a threshold the ticks say is sharp.
    expect(g.match(/%/g)?.length).toBe(BAND_SCALE.length * 2)
    expect(g).toContain('#e30613 0%')
    expect(g).toContain('#10b981 100%')
  })
})

describe('teamBandShare', () => {
  const withEsms = { job: 80, esms: 5, core: 15 }
  const without = { job: 80, esms: 0, core: 20 }

  it('reports each band as a share of what it was out of', () => {
    const s = teamBandShare([
      { weights: without, months: [{ job: 40, esms: null, core: 20, total: 60 }] },
    ])
    expect(s.job).toBe(50)
    expect(s.core).toBe(100)
    expect(s.total).toBe(60)
  })

  it('makes 14 of 15 beat 16 of 20, which raw points cannot', () => {
    const a = teamBandShare([
      { weights: withEsms, months: [{ job: null, esms: null, core: 14, total: null }] },
    ])
    const b = teamBandShare([
      { weights: without, months: [{ job: null, esms: null, core: 16, total: null }] },
    ])
    expect(a.core!).toBeGreaterThan(b.core!)
    expect(a.core).toBeCloseTo(93.3, 1)
    expect(b.core).toBe(80)
  })

  it('gives everyone equal weight regardless of how many months they have', () => {
    // Six months at 60 and one at 90 is 75 per person. Pooling the
    // readings instead gives 64.3 — the person scored more often would
    // quietly count six times.
    const s = teamBandShare([
      { weights: without, months: Array.from({ length: 6 }, () => ({
        job: null, esms: null, core: null, total: 60,
      })) },
      { weights: without, months: [{ job: null, esms: null, core: null, total: 90 }] },
    ])
    expect(s.total).toBe(75)
    expect(s.people).toBe(2)
  })

  it('leaves out people with nothing scored rather than counting them as zero', () => {
    const s = teamBandShare([
      { weights: without, months: [{ job: 80, esms: null, core: 20, total: 100 }] },
      { weights: without, months: [] },
    ])
    expect(s.total).toBe(100)
    expect(s.people).toBe(1)
  })

  it('is null, not zero, when nobody has been scored at all', () => {
    const s = teamBandShare([{ weights: without, months: [] }])
    expect(s.total).toBeNull()
    expect(s.job).toBeNull()
    expect(s.people).toBe(0)
  })

  it('only claims ESMS when somebody actually carries it', () => {
    expect(teamBandShare([{ weights: without, months: [] }]).anyEsms).toBe(false)
    expect(teamBandShare([{ weights: withEsms, months: [] }]).anyEsms).toBe(true)
  })

  it('does not divide by a band worth nothing', () => {
    // Someone without ESMS has an esms weight of 0. That must not become
    // Infinity and drag the team's figure with it.
    const s = teamBandShare([
      { weights: without, months: [{ job: 80, esms: 0, core: 20, total: 100 }] },
      { weights: withEsms, months: [{ job: 80, esms: 5, core: 15, total: 100 }] },
    ])
    expect(s.esms).toBe(100)
    expect(Number.isFinite(s.job!)).toBe(true)
  })
})
