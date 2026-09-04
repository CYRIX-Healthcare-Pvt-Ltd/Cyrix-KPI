import { describe, it, expect } from 'vitest'
import {
  ratingFor, ratingLabel, rankScore, compareRank,
  tatScore, managerRank, JOB_RATIO, CORE_RATIO, MANAGER_WEIGHTS,
} from './rating'

describe('ratingFor — the slab management wrote down', () => {
  it('places the middle of each band', () => {
    expect(ratingFor(95)).toBe(5)
    expect(ratingFor(85)).toBe(4)
    expect(ratingFor(70)).toBe(3)
    expect(ratingFor(55)).toBe(2)
    expect(ratingFor(20)).toBe(1)
  })

  it('closes each band at the top, which is where people will check', () => {
    // ">80 and <=90" means 90 is a 4 and 90.1 is a 5.
    expect(ratingFor(90)).toBe(4)
    expect(ratingFor(90.1)).toBe(5)
    // ">60 and <=80" means 80 is a 3.
    expect(ratingFor(80)).toBe(3)
    expect(ratingFor(80.1)).toBe(4)
  })

  it('makes 60 a 2 and not a 3', () => {
    // The slab reads ">=50 and <=60" for 2 and ">60" for 3, so the
    // boundary belongs to the lower band. This is the one case where the
    // table is inclusive at both ends.
    expect(ratingFor(60)).toBe(2)
    expect(ratingFor(60.01)).toBe(3)
  })

  it('makes exactly 50 a 2, not a 1', () => {
    expect(ratingFor(50)).toBe(2)
    expect(ratingFor(49.99)).toBe(1)
  })

  it('leaves no gap anywhere on the scale', () => {
    for (let p = 0; p <= 200; p += 0.5) {
      expect(ratingFor(p)).not.toBeNull()
    }
  })

  it('treats over-achievement as simply the top band', () => {
    // The whole reason the slab exists: 190% and 95% are both a 5, so
    // one tripled target stops carrying a year.
    expect(ratingFor(190)).toBe(5)
    expect(ratingFor(95)).toBe(5)
  })

  it('says nothing about an unscored figure', () => {
    expect(ratingFor(null)).toBeNull()
    expect(ratingFor(undefined)).toBeNull()
    expect(ratingFor(Number.NaN)).toBeNull()
  })

  it('names each band', () => {
    expect(ratingLabel(5)).toBe('Excellent')
    expect(ratingLabel(1)).toBe('Poor')
    expect(ratingLabel(null)).toBe('')
  })
})

describe('rankScore — 60 job, 40 core', () => {
  it('uses the ratio management chose', () => {
    expect(JOB_RATIO).toBe(0.6)
    expect(CORE_RATIO).toBe(0.4)
  })

  it('settles the example management gave', () => {
    // A: job 4, core 4. B: job 5, core 3. Same simple average; B should
    // come first because the job-role band is higher.
    const a = rankScore({ jobPct: 85, corePct: 85 })   // 4 and 4
    const b = rankScore({ jobPct: 95, corePct: 70 })   // 5 and 3
    expect([a.job, a.core]).toEqual([4, 4])
    expect([b.job, b.core]).toEqual([5, 3])
    expect(b.combined).toBeGreaterThan(a.combined!)
    expect(compareRank(a, b)).toBeGreaterThan(0)
  })

  it('lets core values overturn a job-role gap, which is what 60/40 means', () => {
    // The trade-off accepted when the ratio was chosen: this is exactly
    // the case job-role-first would have ordered the other way.
    const ravi = rankScore({ jobPct: 85, corePct: 95 })  // job 4, core 5 -> 4.4
    const anu = rankScore({ jobPct: 95, corePct: 20 })   // job 5, core 1 -> 3.4
    expect(ravi.combined).toBe(4.4)
    expect(anu.combined).toBe(3.4)
    expect(compareRank(ravi, anu)).toBeLessThan(0)
  })

  it('breaks a tie on the job band', () => {
    // Same combined figure, different halves. The higher job band wins,
    // which is the ratio's intent applied to the case it cannot separate.
    const hi = { job: 5 as const, core: 1 as const, combined: 4 }
    const lo = { job: 3 as const, core: 5 as const, combined: 4 }
    expect(compareRank(hi, lo)).toBeLessThan(0)
  })

  it('stands on one half when only one has been scored', () => {
    expect(rankScore({ jobPct: 95, corePct: null }).combined).toBe(5)
    expect(rankScore({ jobPct: null, corePct: 55 }).combined).toBe(2)
  })

  it('sorts the unscored to the end rather than the bottom', () => {
    const none = rankScore({ jobPct: null, corePct: null })
    const poor = rankScore({ jobPct: 10, corePct: 10 })
    expect(none.combined).toBeNull()
    expect(compareRank(none, poor)).toBeGreaterThan(0)
    expect([poor, none].sort(compareRank)[0]).toBe(poor)
  })
})

describe('tatScore — fewer days is a higher mark', () => {
  it('pays most for the fastest', () => {
    expect(tatScore(0, 5)).toBe(1)
    expect(tatScore(5, 5)).toBe(0.5)   // the whole allowance, half the marks
    expect(tatScore(10, 5)).toBe(0)    // twice the allowance, none
  })

  it('never goes below zero however late', () => {
    expect(tatScore(100, 5)).toBe(0)
  })

  it('separates two people who are both inside the allowance', () => {
    // The point of the component: both are compliant, one is quicker.
    expect(tatScore(2, 5)!).toBeGreaterThan(tatScore(4, 5)!)
  })

  it('moves with the policy rather than a constant', () => {
    expect(tatScore(5, 5)).toBe(0.5)
    expect(tatScore(5, 10)).toBe(0.75)
  })

  it('says nothing when there is nothing to measure', () => {
    expect(tatScore(null, 5)).toBeNull()
    expect(tatScore(3, 0)).toBeNull()
  })
})

describe('managerRank — 10 submission, 20 completion, 70 team, times coverage', () => {
  it('uses the weights management gave', () => {
    // The two turnarounds cap at 30 together; the team carries 70.
    expect(MANAGER_WEIGHTS).toEqual({
      submissionTat: 0.1, completionTat: 0.2, teamBand: 0.7,
    })
    expect(MANAGER_WEIGHTS.submissionTat + MANAGER_WEIGHTS.completionTat).toBeCloseTo(0.3)
  })

  it('gives a perfect manager 100', () => {
    const r = managerRank({
      submitDays: 0, completeDays: 0, teamRatings: [5, 5, 5],
      submitAllowance: 5, completeAllowance: 7, coverage: 1,
    })
    expect(r.overall).toBe(100)
  })

  it('gives the worst measurable manager 0', () => {
    const r = managerRank({
      submitDays: 99, completeDays: 99, teamRatings: [1, 1],
      submitAllowance: 5, completeAllowance: 7, coverage: 1,
    })
    expect(r.overall).toBe(0)
  })

  it('weights the manager own turnaround twice as heavily as the team chasing', () => {
    const base = { teamRatings: [3], submitAllowance: 5, completeAllowance: 5, coverage: 1 }
    // Perfect on the 20% component, worst on the 10% one.
    const goodAtScoring = managerRank({ ...base, submitDays: 99, completeDays: 0 })
    // The other way round.
    const goodAtChasing = managerRank({ ...base, submitDays: 0, completeDays: 99 })
    expect(goodAtScoring.overall!).toBeGreaterThan(goodAtChasing.overall!)
  })

  it('puts the team band on the same 0-1 scale as the TAT marks', () => {
    // A team of all 5s is full marks on that component; all 1s is none.
    const top = managerRank({
      submitDays: null, completeDays: null, teamRatings: [5],
      submitAllowance: 5, completeAllowance: 5, coverage: 1,
    })
    const bottom = managerRank({
      submitDays: null, completeDays: null, teamRatings: [1],
      submitAllowance: 5, completeAllowance: 5, coverage: 1,
    })
    expect(top.overall).toBe(100)
    expect(bottom.overall).toBe(0)
  })

  it('reweights around what cannot be measured rather than scoring it zero', () => {
    // A manager whose team has submitted nothing has no completion TAT.
    // Counting that as nought would rank them below somebody who scored
    // everything late, which is an absence of evidence read as failure.
    const r = managerRank({
      submitDays: null, completeDays: null, teamRatings: [5, 5],
      submitAllowance: 5, completeAllowance: 7, coverage: 1,
    })
    expect(r.submission).toBeNull()
    expect(r.completion).toBeNull()
    expect(r.overall).toBe(100)
  })

  it('has nothing to say about a manager with nothing measurable', () => {
    const r = managerRank({
      submitDays: null, completeDays: null, teamRatings: [],
      submitAllowance: 5, completeAllowance: 7, coverage: 1,
    })
    expect(r.overall).toBeNull()
  })

  it('works the example through end to end', () => {
    // Team submits in 2 of an allowed 5, manager scores in 3 of an
    // allowed 7, team averages a band of 4, everything scored.
    //   submission 1 - 2/10  = 0.8   x 0.1 = 0.08
    //   completion 1 - 3/14  = 0.786 x 0.2 = 0.157
    //   team       (4-1)/4   = 0.75  x 0.7 = 0.525
    //                                       = 0.762 -> 76.2
    const r = managerRank({
      submitDays: 2, completeDays: 3, teamRatings: [4, 4],
      submitAllowance: 5, completeAllowance: 7, coverage: 1,
    })
    expect(r.overall).toBeCloseTo(76.2, 1)
  })

  it('scales the whole figure by coverage rather than adding it in', () => {
    // The case that broke the additive version on real data: a manager
    // perfect on every measurable component, on 1.2% of the work. Under
    // any weighting they came first; multiplied by coverage they cannot.
    const perfect = {
      submitDays: 0, completeDays: 0, teamRatings: [5],
      submitAllowance: 5, completeAllowance: 7,
    }
    expect(managerRank({ ...perfect, coverage: 1 }).overall).toBe(100)
    expect(managerRank({ ...perfect, coverage: 0.012 }).overall).toBeCloseTo(1.2, 1)

    // And the comparison that matters: 80% of the work done adequately
    // beats 1.2% done perfectly.
    const thorough = managerRank({
      submitDays: 6, completeDays: 8, teamRatings: [3, 3],
      submitAllowance: 5, completeAllowance: 7, coverage: 0.8,
    })
    expect(thorough.overall!).toBeGreaterThan(
      managerRank({ ...perfect, coverage: 0.012 }).overall!)
  })

  it('treats coverage it cannot measure as none, not as full', () => {
    // Defaulting an unknown to 1 would hand an unmeasured manager
    // everybody else's marks.
    const r = managerRank({
      submitDays: 0, completeDays: 0, teamRatings: [5],
      submitAllowance: 5, completeAllowance: 7, coverage: null,
    })
    expect(r.overall).toBe(0)
  })
})
