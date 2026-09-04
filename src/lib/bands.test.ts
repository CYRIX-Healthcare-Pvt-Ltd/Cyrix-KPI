import { describe, it, expect } from 'vitest'
import {
  bandFor, attainmentPct, BANDS, BAND_SCALE, bandScaleGradient, teamBandShare,
  teamAverages,
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
    // On management's slab the bands close at the top, so 80% is the top
    // of Good rather than the bottom of Very Good, and 60% is the top of
    // Satisfactory. Both of these read one band higher before 0098.
    // 20-point band: the standard split.
    expect(bandOf(16, 20)).toBe('Good')          // 80%
    expect(bandOf(17, 20)).toBe('Very Good')     // 85%
    expect(bandOf(12, 20)).toBe('Satisfactory')  // 60%
    expect(bandOf(7, 20)).toBe('Poor')           // 35%
    // 15-point band: the people who also carry ESMS.
    expect(bandOf(12, 15)).toBe('Good')          // 80%
    expect(bandOf(14, 15)).toBe('Excellent')     // 93.3%
  })

  it('calls below 50% Poor, which is the change management asked for', () => {
    // 45% was Satisfactory under the app's own scale and is Poor under
    // the company's. This is the relabelling somebody will notice on
    // their own record without their score having moved.
    expect(bandOf(9, 20)).toBe('Poor')            // 45%
    expect(bandOf(10, 20)).toBe('Satisfactory')   // 50% exactly
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
    // Just inside each end rather than on it. The slab's bands are open
    // at the bottom and closed at the top — 60 belongs to Satisfactory,
    // not to the Good that starts above it — so a boundary value itself
    // belongs to the band below and testing it here would be asserting
    // the opposite of the table.
    for (const { band, from, to } of BAND_SCALE) {
      expect(bandFor(from + 0.01)?.key).toBe(band.key)
      expect(bandFor(to - 0.01)?.key).toBe(band.key)
    }
  })

  it('builds a gradient with a hard stop at every boundary', () => {
    const g = bandScaleGradient()
    // Two stops per band — one to open it, one to close it — so the
    // colour does not smear across a threshold the ticks say is sharp.
    expect(g.match(/%/g)?.length).toBe(BAND_SCALE.length * 2)
    // Read off BANDS rather than pinned to particular hexes. The palette
    // is a judgement that gets revisited — Good moved from amber to lime
    // once HR pointed out it means "doing the job as expected" — and a
    // test that fails on a colour change is testing the wrong thing. What
    // must hold is that the ramp covers the whole scale, lowest band at
    // the left edge and highest at the right.
    const lowest = BAND_SCALE[0].band.hex.base
    const highest = BAND_SCALE[BAND_SCALE.length - 1].band.hex.base
    expect(g).toContain(`${lowest} 0%`)
    expect(g).toContain(`${highest} 100%`)
  })

  it('paints everything from Good upward as some kind of green', () => {
    // The point of the ramp, and the thing most likely to be undone by
    // accident: Good is where the person is doing the job as expected,
    // so only the two bands genuinely below expectation carry a warning
    // colour. Hue in HSL — 60°–180° is the green half of the wheel.
    const hueOf = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      if (max === min) return 0
      const d = max - min
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return ((h * 60) + 360) % 360
    }

    for (const key of ['good', 'veryGood', 'excellent'] as const) {
      const band = BANDS.find(b => b.key === key)!
      const hue = hueOf(band.hex.base)
      expect(hue, `${band.label} is not a green (hue ${Math.round(hue)}°)`)
        .toBeGreaterThan(60)
      expect(hue).toBeLessThan(180)
    }

    for (const key of ['poor', 'satisfactory'] as const) {
      const band = BANDS.find(b => b.key === key)!
      const hue = hueOf(band.hex.base)
      // Red sits at the seam of the wheel — Cyrix red is 356°, not 0° —
      // so warm means the arc through red, not simply a small number.
      const warm = hue < 60 || hue > 300
      expect(warm, `${band.label} should read as a warning (hue ${Math.round(hue)}°)`)
        .toBe(true)
    }
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

/**
 * Both figures, because neither one answers on its own.
 *
 * A manager asked why core values read 76% when it is worth 20 marks,
 * and the honest answer was that they had to multiply 76% by 20 to get
 * back to the number their KPI is actually written in. The mark is what
 * people say out loud; the share is the only thing that compares one
 * band against another.
 */
describe('team bands carry marks as well as shares', () => {
  const person = (job: number, core: number, esms = 0) => ({
    weights: { job: 80, esms: esms ? 5 : 0, core: esms ? 15 : 20 },
    months: [{ job, esms: esms || null, core, total: job + core + esms }],
  })

  it('reports the marks people actually think in', () => {
    // 62/80 and 15/20 — the shape of the KPI they agreed.
    const s = teamBandShare([person(62, 15)])
    expect(s.marks.job).toBeCloseTo(62, 5)
    expect(s.marks.core).toBeCloseTo(15, 5)
    expect(s.marks.total).toBeCloseTo(77, 5)
  })

  it('keeps the shares, which are the comparable figures', () => {
    // 62 against 15 says nothing about which band is weaker. 77.5%
    // against 75% says it immediately.
    const s = teamBandShare([person(62, 15)])
    expect(s.job).toBeCloseTo(77.5, 5)
    expect(s.core).toBeCloseTo(75, 5)
  })

  it('the two agree: a share of its denominator is the mark', () => {
    const s = teamBandShare([person(62, 15), person(70, 18)])
    expect((s.job! / 100) * s.outOf.job!).toBeCloseTo(s.marks.job!, 5)
    expect((s.core! / 100) * s.outOf.core!).toBeCloseTo(s.marks.core!, 5)
    // And the bands add up to the total, which is what makes the card
    // readable as one sum rather than three unrelated figures.
    expect(s.marks.job! + s.marks.core!).toBeCloseTo(s.marks.total!, 5)
  })

  it('names a denominator only when the team shares one', () => {
    // Everybody on 20.
    expect(teamBandShare([person(62, 15), person(70, 18)]).outOf.core).toBe(20)
    // One of them carries ESMS, so core values is 15 for them and 20 for
    // the other. Printing either would be wrong for half the team.
    const mixed = teamBandShare([person(62, 15), person(70, 13, 4)])
    expect(mixed.outOf.core).toBeNull()
    expect(mixed.outOf.job).toBe(80)
  })

  it('averages marks over the same people as the shares', () => {
    // Somebody with no scored month is absent, not a zero — in both.
    const s = teamBandShare([person(62, 15), { weights: { job: 80, esms: 0, core: 20 }, months: [] }])
    expect(s.people).toBe(1)
    expect(s.marks.job).toBeCloseTo(62, 5)
  })
})

/**
 * The figure behind the colour on a View team button.
 *
 * One pass over a reporting line answers it for every manager in that
 * line at once, which is the only reason a list of forty rows can each
 * show their own team's standing.
 */
describe("a team's average, per manager, from one reporting line", () => {
  const row = (
    manager: string | null,
    submission_status: string | null,
    final_total_score: number | null,
  ) => ({ reporting_manager_id: manager, submission_status, final_total_score })

  it('averages each manager separately in a single pass', () => {
    const avg = teamAverages([
      row('a', 'scored', 90),
      row('a', 'finalized', 80),
      row('b', 'scored', 40),
    ])
    expect(avg.get('a')).toBe(85)
    expect(avg.get('b')).toBe(40)
  })

  it('counts finalized months the same as scored ones', () => {
    // A finalized month is a scored one that has since closed. Dropping
    // it would make a team's colour drift as the year is signed off.
    expect(teamAverages([row('a', 'finalized', 70)]).get('a')).toBe(70)
  })

  it('leaves out anything that is not a manager score', () => {
    // A self-assessment is the person's own claim, not a score, and a
    // draft is not even that. Averaging either in would colour a branch
    // by how optimistic it is about itself.
    const avg = teamAverages([
      row('a', 'scored', 90),
      row('a', 'submitted', 20),
      row('a', 'draft', 10),
      row('a', null, null),
    ])
    expect(avg.get('a')).toBe(90)
  })

  it('leaves a manager with nobody scored out of the map entirely', () => {
    // Absent, not zero: no colour at all is the right answer for a team
    // that has not been looked at, and a 0 would paint it Poor.
    const avg = teamAverages([row('a', 'draft', null), row('a', 'submitted', 55)])
    expect(avg.has('a')).toBe(false)
    expect(bandFor(avg.get('a') ?? null)).toBeNull()
  })

  it('rounds to one decimal, the way every other average on screen does', () => {
    expect(teamAverages([
      row('a', 'scored', 70),
      row('a', 'scored', 71),
      row('a', 'scored', 73),
    ]).get('a')).toBe(71.3)
  })

  it('ignores rows at the top of the line, which report to nobody', () => {
    expect(teamAverages([row(null, 'scored', 90)]).size).toBe(0)
  })
})
