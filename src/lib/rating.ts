/**
 * The 1–5 slab, and the two rankings built on it.
 *
 * Ranking used to run on the raw KPI percentage, which broke the moment
 * the 120% ceiling came off: somebody who triples one target can carry a
 * year on one row and finish above a person who is solid across all of
 * them. Management's answer is not to cap the score — that falsifies
 * what happened — but to rank on a slab, where 190% and 95% are both
 * simply a 5 and the difference between them stops compounding.
 *
 * Everything here is pure. The figures arrive already computed and
 * already filtered by RLS; nothing in this file queries or decides who
 * may see whom.
 */

export type Rating = 1 | 2 | 3 | 4 | 5

/**
 * The slab, exactly as management wrote it down.
 *
 * Read as: 5 is above 90, 4 is above 80 up to 90, 3 is above 60 up to
 * 80, 2 is 50 to 60 inclusive, 1 is below 50. The boundaries are closed
 * at the top and open at the bottom, which is why 60 is a 2 and not a 3,
 * and 80 is a 3 and not a 4 — worth stating because it is the one thing
 * people will check.
 */
export const RATING_SLAB: Array<{
  rating: Rating
  /** Exclusive lower bound, except for 2 which is inclusive at 50. */
  above: number
  label: string
}> = [
  { rating: 5, above: 90, label: 'Excellent' },
  { rating: 4, above: 80, label: 'Very Good' },
  { rating: 3, above: 60, label: 'Good' },
  { rating: 2, above: 50, label: 'Satisfactory' },
  { rating: 1, above: -Infinity, label: 'Poor' },
]

/**
 * A percentage to its slab.
 *
 * 50 itself is a 2: the slab says ">=50 and <=60", the only boundary in
 * the table that is inclusive at the bottom, and rounding it to a 1
 * would put somebody on exactly half marks in the same band as somebody
 * on nothing.
 */
export function ratingFor(pct: number | null | undefined): Rating | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null
  if (pct >= 50 && pct <= 60) return 2
  return RATING_SLAB.find(s => pct > s.above)?.rating ?? 1
}

export const ratingLabel = (r: Rating | null): string =>
  RATING_SLAB.find(s => s.rating === r)?.label ?? ''

/* ---------------------------------------------------------------------
 * Employee ranking
 * ------------------------------------------------------------------- */

/**
 * How much each half of the KPI counts toward a person's rank.
 *
 * 60/40, chosen by management with the trade-off in front of them: at
 * this ratio core values can overturn a job-role gap, so somebody on job
 * band 4 and core band 5 (4.4) finishes above somebody on job band 5 and
 * core band 1 (3.4). The alternative considered was ranking on the job
 * band alone and using core only to break ties, which would have made a
 * higher job band unbeatable.
 *
 * The job band still breaks ties, so two people on the same combined
 * figure are separated the way the ratio intends rather than by name.
 */
export const JOB_RATIO = 0.6
export const CORE_RATIO = 0.4

export interface RankInput {
  /** Job role attainment, as a percentage of the job-role weightage. */
  jobPct: number | null
  /** Core values attainment, as a percentage of the core weightage. */
  corePct: number | null
}

export interface RankScore {
  job: Rating | null
  core: Rating | null
  /** 1–5, to one decimal. Null when neither half has been scored. */
  combined: number | null
}

export function rankScore({ jobPct, corePct }: RankInput): RankScore {
  const job = ratingFor(jobPct)
  const core = ratingFor(corePct)
  if (job === null && core === null) return { job, core, combined: null }
  // One half scored and not the other is the person's whole record so
  // far, so it stands on its own rather than being averaged against a
  // zero that was never awarded.
  const combined = job === null ? core!
    : core === null ? job
    : JOB_RATIO * job + CORE_RATIO * core
  return { job, core, combined: Math.round(combined * 100) / 100 }
}

/**
 * Orders people for a leaderboard. Highest first.
 *
 * Combined figure, then the job band, then the core band. Anybody with
 * nothing scored sorts to the end rather than to the bottom — they are
 * absent from the ranking, not last in it.
 */
export function compareRank(a: RankScore, b: RankScore): number {
  if (a.combined === null && b.combined === null) return 0
  if (a.combined === null) return 1
  if (b.combined === null) return -1
  if (b.combined !== a.combined) return b.combined - a.combined
  if ((b.job ?? 0) !== (a.job ?? 0)) return (b.job ?? 0) - (a.job ?? 0)
  return (b.core ?? 0) - (a.core ?? 0)
}

/* ---------------------------------------------------------------------
 * Manager ranking
 * ------------------------------------------------------------------- */

/**
 * What a best-manager figure is made of.
 *
 * The two turnaround figures together cap at 30 and the team's own
 * standing carries the other 70, so a manager with a strong team is a
 * strong manager and promptness is the smaller half of the job. These
 * mirror migration 0097 and must not drift from it.
 */
export const MANAGER_WEIGHTS = {
  /** How promptly their team submits. Theirs to chase, not to do. */
  submissionTat: 0.1,
  /** How promptly they score what arrives. The part that is theirs. */
  completionTat: 0.2,
  /** How the team is actually doing, as the average of their slabs. */
  teamBand: 0.7,
} as const

/**
 * How far past the allowance a TAT score reaches zero.
 *
 * Days are turned into marks against the company's own allowance rather
 * than against a constant invented here, so changing the policy moves
 * this with it. At 2, somebody who uses the whole allowance keeps half
 * the marks and somebody who takes twice it keeps none.
 *
 * The alternative — full marks anywhere inside the allowance — cannot
 * rank, because most people are inside it; the whole point of this
 * component is to separate a manager who scores in two days from one who
 * scores in five, and both are compliant.
 */
export const LATE_HORIZON = 2

/** Days to a 0–1 mark. Fewer days is higher, which is what was asked. */
export function tatScore(days: number | null, allowanceDays: number): number | null {
  if (days === null || !Number.isFinite(days)) return null
  if (!(allowanceDays > 0)) return null
  const worst = allowanceDays * LATE_HORIZON
  return Math.max(0, Math.min(1, 1 - days / worst))
}

export interface ManagerRankInput {
  /** Mean days the team took to submit, across the months counted. */
  submitDays: number | null
  /** Mean days this manager took to score once a month arrived. */
  completeDays: number | null
  /** Each scored reportee's combined 1–5, already computed. */
  teamRatings: number[]
  /**
   * The share of the team's owed months actually scored, 0–1.
   *
   * This multiplies the whole figure rather than joining the weighted
   * sum, and that is the load-bearing decision in the whole ranking.
   * Adding it as a fourth weight was tried against real data and failed:
   * a manager who had scored ONE of eighty-one months came first,
   * because every other component — both turnarounds and the team band —
   * was computed from that single month, and scored full marks on it. No
   * set of weights fixes that, because the problem is not how much
   * completion counts; it is that the other three numbers mean nothing
   * without it. A fast turnaround on 1% of your team is not a prompt
   * manager, it is an unmeasured one.
   */
  coverage: number | null
  /** From the live TAT policy, so the marks move when the policy does. */
  submitAllowance: number
  completeAllowance: number
}

export interface ManagerRank {
  submission: number | null
  completion: number | null
  team: number | null
  /** 0–100. Null when nothing at all can be measured yet. */
  overall: number | null
}

/**
 * A manager's standing, out of 100.
 *
 * Components that cannot be measured are dropped and the rest are
 * reweighted among themselves, rather than counted as zero. A manager
 * whose team has submitted nothing has no completion TAT — that is an
 * absence of evidence, and scoring it as nought would rank them below a
 * manager who scored everything late.
 */
export function managerRank(input: ManagerRankInput): ManagerRank {
  const submission = tatScore(input.submitDays, input.submitAllowance)
  const completion = tatScore(input.completeDays, input.completeAllowance)
  const rated = input.teamRatings.filter(r => Number.isFinite(r))
  const team = rated.length
    // Onto 0–1 from the 1–5 slab, so it sits beside the two TAT marks.
    ? (rated.reduce((a, b) => a + b, 0) / rated.length - 1) / 4
    : null

  const parts: Array<[number | null, number]> = [
    [submission, MANAGER_WEIGHTS.submissionTat],
    [completion, MANAGER_WEIGHTS.completionTat],
    [team, MANAGER_WEIGHTS.teamBand],
  ]
  const present = parts.filter(([v]) => v !== null) as Array<[number, number]>
  const weight = present.reduce((a, [, w]) => a + w, 0)
  const quality = weight === 0
    ? null
    : present.reduce((a, [v, w]) => a + v * w, 0) / weight

  // Coverage scales the lot. Missing coverage is treated as none rather
  // than as full: a manager we cannot measure has not demonstrated
  // anything, and defaulting to 1 would hand them everybody else's marks.
  const cover = input.coverage === null || !Number.isFinite(input.coverage)
    ? 0
    : Math.max(0, Math.min(1, input.coverage))

  return {
    submission,
    completion,
    team,
    overall: quality === null ? null : Math.round(quality * cover * 1000) / 10,
  }
}
