import clsx from 'clsx'
import { ArrowUpToLine, ChevronsUp, TrendingDown } from 'lucide-react'
import { ruleTraits, type ScoringRule, type RuleParams, type TraitTone } from '@/lib/scoring'

/**
 * What this row can do to a score, in colour.
 *
 * The rule itself is a phrase in a picker, seen once, on the day the KPI
 * is written. Every time the row is met afterwards — the manager
 * approving it, the person filling the month in, the manager scoring it
 * — it is grey lowercase text at the bottom of a card, and nothing
 * distinguishes a row that stops at its weightage from one that can take
 * points off the total.
 *
 * Three colours, meaning what they mean everywhere else in the app:
 * green is above expectation, red is a loss, grey is the ordinary case.
 *
 * The label carries the meaning on its own — "Can go below zero" is not
 * a colour — so the chips still work for anybody who cannot separate the
 * two. The colour is what makes them findable at a glance in a page of
 * fifteen rows.
 */
const TONE: Record<TraitTone, { chip: string; icon: typeof ArrowUpToLine }> = {
  capped:  { chip: 'bg-ink-100 text-ink-600',            icon: ArrowUpToLine },
  bonus:   { chip: 'bg-emerald-100 text-emerald-800',    icon: ChevronsUp },
  penalty: { chip: 'bg-cyrixRed-100 text-cyrixRed-800',  icon: TrendingDown },
}

export default function RuleTraits({
  rule, weightage, params, className,
}: {
  rule: ScoringRule
  weightage: number
  params?: RuleParams
  className?: string
}) {
  const traits = ruleTraits(rule, weightage, params ?? {})
  if (traits.length === 0) return null

  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1.5', className)}>
      {traits.map(trait => {
        const { chip, icon: Icon } = TONE[trait.tone]
        return (
          <span
            key={trait.label}
            // title rather than a tooltip component: it has to work
            // inside a table cell and a wrapped label on a 375px screen,
            // and the label already says the short version.
            title={trait.detail}
            className={clsx('badge gap-1 whitespace-nowrap normal-case tracking-normal', chip)}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            {trait.label}
          </span>
        )
      })}
    </span>
  )
}
