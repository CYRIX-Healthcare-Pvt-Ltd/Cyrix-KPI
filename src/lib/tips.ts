/**
 * The things people never find on their own.
 *
 * Every one of these already exists and is one tap away, and almost
 * nobody knows about it — you can put a photo on your record, query a
 * score you disagree with, read the whole manual in Malayalam, save a
 * KPI template for your whole line. None of that is discoverable by
 * pressing things at random, and the manual only helps somebody who has
 * already decided to go and read a manual.
 *
 * So Cyra mentions one when she says hello. One, not a list: a panel
 * that opens with eight suggestions is a panel people stop opening. It
 * rotates, so somebody who opens it every day for a fortnight learns
 * fourteen things rather than reading the same sentence fourteen times.
 *
 * A tip is only shown when it is true for the person reading it. There
 * is no point telling a team member about approving KPIs, and no point
 * telling somebody with no scored month that they can see their rank.
 */

export interface TipContext {
  isManager: boolean
  isHrAdmin: boolean
  /** Do they have a KPI for the year at all? */
  hasKpi: boolean
  /** Has any month actually been scored? */
  hasScoredMonth: boolean
}

export interface Tip {
  /** Key into CHAT — the sentence, in five languages. */
  key: string
  /** Where it goes. Null for the ones about this panel itself. */
  to: string | null
  /** English on purpose: it is the name on the tab. */
  toLabel: string
  /** Shown only when this is true of the reader. */
  when?: (ctx: TipContext) => boolean
}

const anyone = undefined
const scored = (c: TipContext) => c.hasScoredMonth
const hasKpi = (c: TipContext) => c.hasKpi
const manager = (c: TipContext) => c.isManager
const notHr = (c: TipContext) => !c.isHrAdmin

/**
 * Ordered roughly by how often the thing is useful rather than by
 * screen, so somebody who only ever sees the first three still learns
 * the three that matter most.
 */
export const TIPS: Tip[] = [
  // ---- your own record
  { key: 'tip.photo', to: '/me', toLabel: 'My profile', when: notHr },
  { key: 'tip.rank', to: '/me', toLabel: 'My profile', when: scored },
  { key: 'tip.language', to: null, toLabel: '', when: anyone },
  { key: 'tip.manual', to: '/help', toLabel: 'The manual', when: anyone },

  // ---- the monthly job
  { key: 'tip.months', to: '/history', toLabel: 'Assessments', when: hasKpi },
  { key: 'tip.query', to: '/history', toLabel: 'Assessments', when: scored },
  { key: 'tip.split', to: '/my-kpi', toLabel: 'My KPI', when: hasKpi },
  { key: 'tip.alternates', to: '/my-kpi', toLabel: 'My KPI', when: hasKpi },
  { key: 'tip.startmonth', to: '/my-kpi', toLabel: 'My KPI', when: hasKpi },

  // ---- the app itself
  { key: 'tip.install', to: '/me', toLabel: 'My profile', when: anyone },
  { key: 'tip.dark', to: null, toLabel: '', when: anyone },
  { key: 'tip.support', to: null, toLabel: '', when: anyone },
  { key: 'tip.ask', to: null, toLabel: '', when: anyone },

  // ---- a manager's own tools
  { key: 'tip.templates', to: '/team/templates', toLabel: 'KPI templates', when: manager },
  { key: 'tip.analysis', to: '/team', toLabel: 'My Team', when: manager },
  { key: 'tip.drill', to: '/team', toLabel: 'My Team', when: manager },
  { key: 'tip.approveall', to: '/approvals', toLabel: 'Approvals', when: manager },
  { key: 'tip.export', to: '/team', toLabel: 'My Team', when: manager },
  { key: 'tip.mgrrank', to: '/me', toLabel: 'My profile', when: manager },
]

/** The ones that apply to this person, in order. */
export const tipsFor = (ctx: TipContext): Tip[] =>
  TIPS.filter(t => !t.when || t.when(ctx))

/**
 * One tip, advancing each time.
 *
 * `seen` is how many have been shown to this person before, kept per
 * device. Modulo rather than random: random repeats itself and skips
 * things, and somebody who opens the panel every morning should work
 * through the list rather than being handed the same tip twice in a
 * week by chance.
 */
export function pickTip(ctx: TipContext, seen: number): Tip | null {
  const list = tipsFor(ctx)
  if (list.length === 0) return null
  const n = Math.max(0, Math.floor(seen))
  return list[n % list.length]
}
