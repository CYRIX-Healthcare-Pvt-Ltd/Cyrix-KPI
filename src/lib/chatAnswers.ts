import { CHAT } from './chat-strings'
import { say, type Lang } from './i18n'
import { monthLabel } from './fy'
import { bandFor } from './bands'
import { ratingToPoints } from './scoring'
import { WEAK_THRESHOLD } from './bands'
import type { FactId } from './chatbot'

/**
 * Turning a matched question into a sentence.
 *
 * Out here rather than inside the panel so it can be run against the
 * real database without a browser — which is the only way to know that
 * "lowest score teammember in july" returns the person it should,
 * rather than the person who happens to be asking.
 *
 * Every branch reads data the caller already loaded. Nothing here
 * queries, and nothing here decides who may see what: the roster and the
 * submissions arrive already filtered by RLS, so a manager can only ever
 * be told about people the server was willing to return.
 */

export interface Scored {
  employee_id: string
  period_month: string
  status: string
  final_total_score: number | null
  mgr_total_score: number | null
}

export interface Person {
  id: string
  ecode: string
  full_name: string
}

export interface AnswerContext {
  lang: Lang
  fy: string
  /** Blank for shared system logins, which have no first name. */
  firstName: string
  me: { full_name: string; ecode: string }
  /** The asker's own months. */
  history: Scored[]
  annual?: {
    months_scored: number
    avg_total_score: number | null
    avg_job_role_score: number | null
    avg_esms_score: number | null
    avg_core_values_score: number | null
  } | null
  kpiStatus?: string | null
  pending?: { approvals: number; scoring: number } | null
  /** A manager's direct reports, already filtered by the server. */
  team?: Person[]
  /** Every month of theirs, for the year. */
  teamMonths?: Scored[]
  /** Which month was named, 0-11. */
  month?: number
  /** Which person was named. */
  ecode?: string
  /** One row per KRA per month — the only place a single row's own
   *  attainment lives. The section totals cannot answer "which row". */
  kras?: Array<{
    period_month: string
    section: string
    kra: string
    weightage: number
    attainment_pct: number | null
  }>
  /** The five core values rated separately, month by month. */
  coreTrend?: Array<{ core_value_id: string; period_month: string; rating: string | null }>
  coreValues?: Array<{ id: string; name: string }>
}

/**
 * Earlier in the year against lately.
 *
 * Split down the middle of whatever months exist rather than "last month
 * vs the one before": with four scored months a single bad month is not
 * a trend, and two halves of two is the least noisy thing that can be
 * said honestly. Needs at least two points either side of the line to
 * claim anything is falling.
 */
function halves(points: Array<{ period_month: string; value: number }>) {
  if (points.length < 3) return null
  const ordered = [...points].sort((a, b) => a.period_month.localeCompare(b.period_month))
  const mid = Math.floor(ordered.length / 2)
  const mean = (xs: typeof ordered) => xs.reduce((a, x) => a + x.value, 0) / xs.length
  return { from: mean(ordered.slice(0, mid)), to: mean(ordered.slice(mid)) }
}

const scoreOf = (s: Scored | undefined) =>
  s?.final_total_score ?? s?.mgr_total_score ?? null

/** April–March: January belongs to the year after the FY is named for. */
export const monthStamp = (fy: string, month: number): string => {
  const [startYear] = fy.split('-').map(Number)
  const year = month >= 3 ? startYear : startYear + 1
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export function answerFact(id: FactId, ctx: AnswerContext): string {
  const t = (key: string, vars?: Record<string, string | number>) =>
    say(CHAT[key], ctx.lang, vars)
      // A shared login has no first name, which leaves "Hello ." behind.
      .replace(/,?\s+\./g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim()

  const band = (v: number | null | undefined) => bandFor(v)?.label ?? ''
  const named = ctx.month !== undefined ? monthStamp(ctx.fy, ctx.month) : null
  const scope = named ? monthLabel(`${named}-01`) : t('scope.year')

  const mine = ctx.history.filter(s => scoreOf(s) !== null)
  const latest = mine[mine.length - 1]

  // A manager's team, reduced to one figure each for the window asked
  // about — a named month, or their average across the year.
  const perPerson = () => {
    const out: Array<{ person: Person; score: number }> = []
    for (const person of ctx.team ?? []) {
      const theirs = (ctx.teamMonths ?? []).filter(
        s => s.employee_id === person.id
          && scoreOf(s) !== null
          && (!named || s.period_month.startsWith(named)))
      if (theirs.length === 0) continue
      const mean = theirs.reduce((a, s) => a + scoreOf(s)!, 0) / theirs.length
      out.push({ person, score: mean })
    }
    return out.sort((a, b) => b.score - a.score)
  }

  switch (id) {
    case 'manual': return t('manual')
    case 'chit.hello': return t('greeting', { name: ctx.firstName })
    case 'chit.whoisbot': return t('whoisbot')
    case 'whoami': return t('whoami', { name: ctx.me.full_name, ecode: ctx.me.ecode })

    case 'score.last': {
      const v = scoreOf(latest)
      if (!latest || v === null) return t('year.none')
      return t('month.scored', {
        month: monthLabel(latest.period_month), score: v.toFixed(2), band: band(v),
      })
    }

    case 'score.month': {
      const row = ctx.history.find(s => s.period_month.startsWith(named!))
      const label = monthLabel(`${named}-01`)
      if (!row) return t('month.none', { month: label })
      const v = scoreOf(row)
      if (v === null) {
        return t(row.status === 'draft' ? 'month.draft' : 'month.waiting', { month: label })
      }
      return t('month.scored', { month: label, score: v.toFixed(2), band: band(v) })
    }

    case 'score.year': {
      const avg = ctx.annual?.avg_total_score
      if (avg === null || avg === undefined) return t('year.none')
      return t('year', {
        fy: ctx.fy, avg: avg.toFixed(2),
        n: ctx.annual?.months_scored ?? 0, band: band(avg),
      })
    }

    case 'score.split': {
      const a = ctx.annual
      if (!a || a.avg_total_score === null) return t('year.none')
      const parts = [
        `Job Role ${a.avg_job_role_score?.toFixed(1) ?? '—'} / 80`,
        a.avg_esms_score !== null ? `ESMS ${a.avg_esms_score.toFixed(1)} / 5` : null,
        `Core Values ${a.avg_core_values_score?.toFixed(1) ?? '—'} / ${a.avg_esms_score !== null ? 15 : 20}`,
      ].filter(Boolean)
      return t('split', { parts: parts.join(', ') })
    }

    case 'score.months': {
      const done = ctx.annual?.months_scored ?? 0
      const waiting = ctx.history.filter(
        s => s.status === 'draft' || s.status === 'submitted').length
      return waiting ? t('months.open', { done, open: waiting }) : t('months', { done })
    }

    case 'score.bestworst': {
      if (mine.length === 0) return t('bestworst.none')
      const ranked = [...mine].sort((a, b) => scoreOf(b)! - scoreOf(a)!)
      const top = ranked[0], bottom = ranked[ranked.length - 1]
      return t('bestworst', {
        best: monthLabel(top.period_month), bestScore: scoreOf(top)!.toFixed(2),
        worst: monthLabel(bottom.period_month), worstScore: scoreOf(bottom)!.toFixed(2),
      })
    }

    case 'kpi.status': {
      const byStatus: Record<string, string> = {
        active: 'kpi.active', pending_approval: 'kpi.pending',
        rejected: 'kpi.rejected', draft: 'kpi.draft',
      }
      return t(byStatus[ctx.kpiStatus ?? ''] ?? 'kpi.none')
    }

    case 'team.pending': {
      const k = ctx.pending?.approvals ?? 0
      const m = ctx.pending?.scoring ?? 0
      if (!k && !m) return t('team.clear')
      const parts = [
        k ? t('team.approvals', { n: k }) : null,
        m ? t('team.scoring', { n: m }) : null,
      ].filter(Boolean)
      return t('team.waiting', { parts: parts.join(', ') })
    }

    // ---- the team -------------------------------------------------
    case 'team.size':
      return t('team.size', { n: (ctx.team ?? []).length })

    case 'team.average': {
      const rows = perPerson()
      if (rows.length === 0) return t('team.nodata', { scope })
      const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length
      return t('team.average', {
        avg: avg.toFixed(2), n: rows.length, scope, band: band(avg),
      })
    }

    case 'team.lowest':
    case 'team.highest': {
      const rows = perPerson()
      if (rows.length === 0) return t('team.nodata', { scope })
      const pick = id === 'team.lowest' ? rows[rows.length - 1] : rows[0]
      return t(id, {
        name: pick.person.full_name, ecode: pick.person.ecode,
        score: pick.score.toFixed(2), scope, band: band(pick.score),
      })
    }

    case 'team.notdone': {
      // Without a month named, the most recent one anybody has sent is
      // the one being asked about.
      const stamp = named ?? [...(ctx.teamMonths ?? [])]
        .map(s => s.period_month.slice(0, 7)).sort().pop()
      if (!stamp) return t('team.nodata', { scope })
      const label = monthLabel(`${stamp}-01`)
      const sent = new Set((ctx.teamMonths ?? [])
        .filter(s => s.period_month.startsWith(stamp) && s.status !== 'draft')
        .map(s => s.employee_id))
      const missing = (ctx.team ?? []).filter(p => !sent.has(p.id))
      if (missing.length === 0) return t('team.alldone', { month: label })
      return t('team.notdone', {
        n: missing.length, total: (ctx.team ?? []).length, month: label,
        names: missing.map(p => `${p.full_name} (${p.ecode})`).join(', '),
      })
    }

    case 'team.weak': {
      const rows = perPerson()
      if (rows.length === 0) return t('team.nodata', { scope })
      const weak = rows.filter(r => r.score < WEAK_THRESHOLD)
      if (weak.length === 0) return t('team.allgood', { scope })
      return t('team.weak', {
        n: weak.length, scope,
        names: weak.map(r => `${r.person.full_name} ${r.score.toFixed(1)}`).join(', '),
      })
    }

    case 'team.person': {
      const person = (ctx.team ?? []).find(p => p.ecode === ctx.ecode)
      if (!person) return t('lost', { name: ctx.firstName })
      const rows = perPerson().filter(r => r.person.id === person.id)
      if (rows.length === 0) {
        return t('team.person.none', {
          name: person.full_name, ecode: person.ecode, scope,
        })
      }
      const v = rows[0].score
      return t('team.person', {
        name: person.full_name, ecode: person.ecode,
        scope, score: v.toFixed(2), band: band(v),
      })
    }

    // ---- one row of the KPI ---------------------------------------
    case 'kra.weakest':
    case 'kra.best': {
      const rows = ctx.kras ?? []
      if (rows.length === 0) return t('kra.none')
      const byKra = new Map<string, { pct: number[]; weightage: number; section: string }>()
      for (const r of rows) {
        if (r.attainment_pct === null) continue
        const e = byKra.get(r.kra) ?? { pct: [], weightage: r.weightage, section: r.section }
        e.pct.push(r.attainment_pct)
        byKra.set(r.kra, e)
      }
      const ranked = [...byKra.entries()]
        .map(([kra, e]) => ({
          kra, weightage: e.weightage,
          pct: e.pct.reduce((a, b) => a + b, 0) / e.pct.length,
        }))
        .sort((a, b) => b.pct - a.pct)
      if (ranked.length === 0) return t('kra.none')
      const top = ranked[0], bottom = ranked[ranked.length - 1]
      if (id === 'kra.best') {
        return t('kra.best', {
          kra: top.kra, pct: top.pct.toFixed(1),
          weightage: top.weightage, band: band(top.pct),
        })
      }
      return t('kra.weakest', {
        kra: bottom.kra, pct: bottom.pct.toFixed(1), weightage: bottom.weightage,
        band: band(bottom.pct), best: top.kra, bestPct: top.pct.toFixed(1),
      })
    }

    case 'kra.declining': {
      const rows = (ctx.kras ?? []).filter(r => r.attainment_pct !== null)
      if (rows.length === 0) return t('kra.none')
      const names = [...new Set(rows.map(r => r.kra))]
      let worst: { kra: string; from: number; to: number; drop: number } | null = null
      for (const kra of names) {
        const h = halves(rows.filter(r => r.kra === kra)
          .map(r => ({ period_month: r.period_month, value: r.attainment_pct! })))
        if (!h) continue
        const drop = h.from - h.to
        if (drop > 0 && (!worst || drop > worst.drop)) worst = { kra, ...h, drop }
      }
      if (worst) {
        return t('kra.declining', {
          kra: worst.kra, from: worst.from.toFixed(1), to: worst.to.toFixed(1),
        })
      }
      // Nothing falling is an answer, and a better one than silence.
      const lowest = names
        .map(kra => {
          const xs = rows.filter(r => r.kra === kra).map(r => r.attainment_pct!)
          return { kra, pct: xs.reduce((a, b) => a + b, 0) / xs.length }
        })
        .sort((a, b) => a.pct - b.pct)[0]
      return t('kra.steady', { kra: lowest.kra, pct: lowest.pct.toFixed(1) })
    }

    case 'core.weakest':
    case 'core.declining': {
      const trend = (ctx.coreTrend ?? []).filter(r => r.rating)
      const names = new Map((ctx.coreValues ?? []).map(v => [v.id, v.name]))
      if (trend.length === 0) return t('core.none')
      const points = trend.map(r => ({
        id: r.core_value_id, period_month: r.period_month,
        value: ratingToPoints(r.rating) ?? 0,
      }))
      const ids = [...new Set(points.map(p => p.id))]

      if (id === 'core.declining') {
        let worst: { id: string; from: number; to: number; drop: number } | null = null
        for (const cv of ids) {
          const h = halves(points.filter(p => p.id === cv))
          if (!h) continue
          const drop = h.from - h.to
          if (drop > 0 && (!worst || drop > worst.drop)) worst = { id: cv, ...h, drop }
        }
        if (worst) {
          return t('core.declining', {
            name: names.get(worst.id) ?? 'A core value',
            from: worst.from.toFixed(0), to: worst.to.toFixed(0),
          })
        }
      }

      const ranked = ids
        .map(cv => {
          const xs = points.filter(p => p.id === cv).map(p => p.value)
          return { id: cv, pct: xs.reduce((a, b) => a + b, 0) / xs.length }
        })
        .sort((a, b) => a.pct - b.pct)
      const low = ranked[0]
      return t(id === 'core.declining' ? 'core.steady' : 'core.weakest', {
        name: names.get(low.id) ?? 'A core value', pct: low.pct.toFixed(0),
      })
    }

    case 'team.overview': {
      const rows = perPerson()
      if (rows.length === 0) return t('team.nodata', { scope })
      const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length
      return t('team.overview', {
        n: rows.length, avg: avg.toFixed(2), scope,
        best: `${rows[0].person.full_name} ${rows[0].score.toFixed(1)}`,
        worst: `${rows[rows.length - 1].person.full_name} ${rows[rows.length - 1].score.toFixed(1)}`,
      })
    }
  }
}
