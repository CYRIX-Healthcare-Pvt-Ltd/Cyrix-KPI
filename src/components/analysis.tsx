import type { ReactNode } from 'react'
import clsx from 'clsx'
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Trophy } from 'lucide-react'
import { bandFor, isWeak, trendOf, WEAK_THRESHOLD, type Band } from '@/lib/bands'
import type { KraAttainmentRow, WeakAreaRow } from '@/types/db'

/**
 * A page header washed in the colour of the score it reports on.
 *
 * The tint is deliberately soft: the brand is the Cyrix black/blue/red,
 * and the score band is an accent on top of it, not a repaint.
 */
export function ScoreHeader({
  title,
  subtitle,
  score,
  scoreLabel = 'Average',
  children,
}: {
  title: string
  subtitle?: string
  score: number | null | undefined
  scoreLabel?: string
  children?: ReactNode
}) {
  const band = bandFor(score)

  return (
    <div
      className={clsx(
        'score-wash',
        band ? `${band.wash} border border-ink-200` : 'from-ink-100 border border-ink-200',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>

        {score !== null && score !== undefined && band && (
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {scoreLabel}
            </p>
            <p className={clsx('text-3xl font-bold tabular-nums', band.accent)}>
              {score.toFixed(1)}
            </p>
            <span className={clsx('badge mt-1', band.chip)}>{band.label}</span>
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

export function BandChip({ pct }: { pct: number | null | undefined }) {
  const band = bandFor(pct)
  if (!band) return <span className="text-ink-400">—</span>
  return <span className={clsx('badge', band.chip)}>{band.label}</span>
}

export function TrendChip({ scores }: { scores: Array<number | null> }) {
  const trend = trendOf(scores)
  if (!trend) return <span className="text-xs text-ink-400">not enough months</span>

  const cfg = {
    up:   { Icon: TrendingUp,   cls: 'text-emerald-700',   text: `improving +${trend.delta}` },
    down: { Icon: TrendingDown, cls: 'text-cyrixRed-700',  text: `declining ${trend.delta}` },
    flat: { Icon: Minus,        cls: 'text-ink-500',       text: 'steady' },
  }[trend.direction]

  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', cfg.cls)}>
      <cfg.Icon className="h-3.5 w-3.5" /> {cfg.text}
    </span>
  )
}

/**
 * Where someone is genuinely weak.
 *
 * Judged against the band scale, not against their own best row — a KRA
 * at 90% of its weightage is fine even if it is their lowest. Only rows
 * below Good are surfaced.
 */
export function WeakAreas({
  areas,
  emptyMessage = 'Nothing below Good — all areas are on track.',
}: {
  areas: WeakAreaRow[]
  emptyMessage?: string
}) {
  const weak = areas
    .filter(a => isWeak(a.avg_attainment_pct))
    .sort((a, b) => (a.avg_attainment_pct ?? 0) - (b.avg_attainment_pct ?? 0))

  if (weak.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        <Trophy className="h-4 w-4 shrink-0" />
        {emptyMessage}
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {weak.map(a => {
        const band = bandFor(a.avg_attainment_pct) as Band
        return (
          <li
            key={`${a.section}-${a.kra}`}
            className="flex items-center gap-3 rounded-lg border border-ink-200 p-3"
          >
            <AlertTriangle className={clsx('h-4 w-4 shrink-0', band.accent)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">{a.kra}</p>
              <p className="text-xs text-ink-500">
                {a.section === 'job_role' ? 'Job role' : 'Core values'} · {a.months} month
                {a.months === 1 ? '' : 's'}
              </p>
            </div>
            <div className="text-right">
              <p className={clsx('text-sm font-semibold tabular-nums', band.accent)}>
                {a.avg_attainment_pct?.toFixed(0)}%
              </p>
              <p className="text-[11px] text-ink-400">of weightage</p>
            </div>
            <span className={clsx('badge', band.chip)}>{band.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Horizontal bars of attainment per KRA — quick to scan for soft spots. */
export function KraBars({ rows }: { rows: KraAttainmentRow[] }) {
  const byKra = new Map<string, { section: string; total: number; n: number }>()
  for (const r of rows) {
    if (r.attainment_pct === null) continue
    const cur = byKra.get(r.kra) ?? { section: r.section, total: 0, n: 0 }
    cur.total += r.attainment_pct
    cur.n += 1
    byKra.set(r.kra, cur)
  }

  const items = [...byKra.entries()]
    .map(([kra, v]) => ({ kra, section: v.section, pct: v.total / v.n }))
    .sort((a, b) => a.pct - b.pct)

  if (items.length === 0) {
    return <p className="text-sm text-ink-500">No scored months yet.</p>
  }

  return (
    <div className="space-y-3">
      {items.map(i => {
        const band = bandFor(i.pct) as Band
        return (
          <div key={i.kra}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-ink-700">{i.kra}</span>
              <span className={clsx('text-xs font-semibold tabular-nums', band.accent)}>
                {i.pct.toFixed(0)}%
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-ink-100">
              <div
                className={clsx('h-full rounded-full transition-all', band.bar)}
                style={{ width: `${Math.max(0, Math.min(100, i.pct))}%` }}
              />
              {/* The line below which we call something weak. */}
              <div
                className="absolute inset-y-0 w-px bg-ink-400/50"
                style={{ left: `${WEAK_THRESHOLD}%` }}
                title={`Below ${WEAK_THRESHOLD}% needs attention`}
              />
            </div>
          </div>
        )
      })}
      <p className="pt-1 text-[11px] text-ink-400">
        The marker sits at {WEAK_THRESHOLD}% — anything left of it is below Good.
      </p>
    </div>
  )
}
