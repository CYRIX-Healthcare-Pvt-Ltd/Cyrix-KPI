import { WEAK_THRESHOLD } from './bands'

/**
 * Where somebody stands, said out loud, with the lever attached.
 *
 * The positions already exist — a rank tile on the profile, a team
 * average on the team screen, a turnaround figure in a tooltip — and a
 * number sitting on a screen somebody has to go and open is a number
 * nobody acts on. So Cyra says one of them when she opens, the way a
 * colleague would: the position, then the one thing that moves it.
 *
 * Two standings, and they must never be confused. A person's own rank is
 * their own score: their weakest KRA is what moves it. A manager's
 * standing is their team's — 70% the team's own scores, 20% how quickly
 * they score what arrives, 10% how quickly their team sends it. Telling
 * a manager to fix their own FTFR to climb the manager table would be
 * advice that cannot work, so a line here always names a lever belonging
 * to the standing it just mentioned.
 *
 * Never a medal and never a taunt. A position is stated once, plainly,
 * and is always followed by something the reader can actually do — the
 * same rule the idle opening follows, and for the same reason: "you are
 * 160th" on its own is an accusation, and nobody opens a panel twice
 * that tells them they are losing.
 */

export interface TeamStanding {
  /** Position among managers, and the field. */
  rank: number | null
  of: number | null
  /** Days past the allowance their scoring runs, and the allowance. */
  scoreLate: number | null
  scoreAllowance: number
  /** The same for the team's submissions, which they chase rather than do. */
  submitLate: number | null
  submitAllowance: number
  /** Months the team owes, and how many are scored. */
  due: number | null
  scored: number | null
  /** The team's year average out of 100, and whoever is lowest in it. */
  average: number | null
  lowest: { id: string; name: string; score: number } | null
}

export interface StandingContext {
  /** Their own position for the year, among everybody with a score. */
  rank: number | null
  of: number | null
  /** Their own weakest KRA, and what closing it is worth. */
  lever: { kra: string; target: number; gain: number } | null
  /** The year so far against the last few months. */
  climb: { soFar: number; recent: number } | null
  /** Null for anybody with nobody reporting to them. */
  team: TeamStanding | null
}

export interface StandingLine {
  /** Key into CHAT — the sentence, in five languages. */
  key: string
  vars: Record<string, string | number>
  to?: string
  /** English on purpose: it is the name on the tab. */
  toLabel?: string
}

const one = (n: number) => n.toFixed(1)

/**
 * Every line that is true for this person, most useful first.
 *
 * A manager's own team comes before their own score, because the team is
 * where a manager's day goes and 70% of their standing with it. Inside
 * that: somebody who needs help, then the two clocks, then the position
 * itself — a position is the least actionable of the four and belongs
 * after the things that move it.
 */
export function standingLines(ctx: StandingContext): StandingLine[] {
  const out: StandingLine[] = []
  const team = ctx.team

  if (team) {
    // Only where the figure is genuinely low. "The lowest in your team"
    // said of somebody on 78 is a ranking dressed up as a concern, and
    // it would put a good performer's name in their manager's panel.
    if (team.lowest && team.lowest.score < WEAK_THRESHOLD) {
      out.push({
        key: 'stand.mgrlowest',
        vars: { name2: team.lowest.name, score: one(team.lowest.score) },
        to: `/team/${team.lowest.id}`,
        toLabel: 'My Team',
      })
    }
    if (team.scoreLate !== null && team.scoreLate > 0) {
      out.push({
        key: 'stand.mgrslow',
        vars: { days: one(team.scoreLate), allow: team.scoreAllowance },
        to: '/team',
        toLabel: 'My Team',
      })
    }
    if (team.submitLate !== null && team.submitLate > 0) {
      out.push({
        key: 'stand.mgrlate',
        vars: { days: one(team.submitLate), allow: team.submitAllowance },
        to: '/team',
        toLabel: 'My Team',
      })
    }
    // Nothing about how much is done enters the mark — 0098 took the
    // coverage multiplier off. What is true, and is what the line now
    // says, is that an unscored month is not measured at all: it is in
    // neither the team band nor either clock, so it counts for nobody.
    if (team.due !== null && team.scored !== null && team.due > 0 && team.scored < team.due) {
      out.push({
        key: 'stand.mgrdone',
        vars: { done: team.scored, due: team.due },
        to: '/team',
        toLabel: 'My Team',
      })
    }
    if (team.rank !== null && team.of !== null && team.of > 1) {
      out.push({
        key: 'stand.mgrrank',
        vars: { rank: team.rank, of: team.of },
        to: '/me',
        toLabel: 'My profile',
      })
    }
    if (team.average !== null) {
      out.push({
        key: 'stand.mgrteam',
        vars: { avg: one(team.average) },
        to: '/team/analysis',
        toLabel: 'Team analysis',
      })
    }
  }

  // Their own score. A field of one is not a position, so it is not
  // stated as one — a divisional head ranked "1 of 1" learns nothing.
  if (ctx.rank !== null && ctx.of !== null && ctx.of > 1) {
    if (ctx.rank <= 10) {
      out.push({ key: 'stand.ranktop', vars: { rank: ctx.rank, of: ctx.of }, to: '/me', toLabel: 'My profile' })
    } else if (ctx.lever) {
      out.push({
        key: 'stand.ranklever',
        vars: {
          rank: ctx.rank, of: ctx.of, kra: ctx.lever.kra,
          target: ctx.lever.target, gain: one(ctx.lever.gain),
        },
        to: '/my-kpi',
        toLabel: 'My KPI',
      })
    } else {
      out.push({ key: 'stand.rank', vars: { rank: ctx.rank, of: ctx.of }, to: '/me', toLabel: 'My profile' })
    }
  }

  if (ctx.climb && ctx.climb.recent > ctx.climb.soFar) {
    out.push({
      key: 'stand.climb',
      vars: { soFar: one(ctx.climb.soFar), recent: one(ctx.climb.recent) },
      to: '/history',
      toLabel: 'Assessments',
    })
  }

  return out
}

/**
 * One of them, rotating, so a fortnight of openings says a fortnight of
 * different things rather than the same sentence fourteen times. Same
 * counter idea as the tips, and a separate counter so the two do not
 * step over each other.
 *
 * `already` is what the opening line has said this time. With nothing
 * outstanding, Cyra opens by offering the best KRA to work on — and the
 * standing line offered the same KRA and the same figure directly
 * underneath it. Two of the three sentences in the panel were one
 * sentence.
 *
 * The fact is taken away rather than the line: without the lever, the
 * rank line states the position on its own, which is still worth saying
 * and is no longer a repeat. Dropping the line outright would have cost
 * somebody with nothing waiting their position altogether — and they are
 * the reader with the least else to see.
 */
export function pickStanding(
  ctx: StandingContext,
  seen: number,
  already: readonly string[] = [],
): StandingLine | null {
  const spent: StandingContext = {
    ...ctx,
    lever: already.includes('stand.ranklever') ? null : ctx.lever,
    climb: already.includes('stand.climb') ? null : ctx.climb,
  }
  const list = standingLines(spent).filter(line => !already.includes(line.key))
  if (list.length === 0) return null
  return list[Math.max(0, Math.floor(seen)) % list.length]
}
