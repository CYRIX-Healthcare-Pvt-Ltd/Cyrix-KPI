import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
  const pct = Math.max(0, Math.min(100, score ?? 0))

  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink-950 text-white">
      {/* A wash of the band colour bleeding in from the score side. It is
          the one place the performance colour is allowed to dominate. */}
      {/* Band-coloured light drifting from the top-right corner down toward
          the bottom-left and back. Two layers on 18s and 27s so they
          separate and rejoin, which stops the loop reading as a loop.
          Colour comes from --score-accent rather than a Tailwind class, so
          it tracks the band without shipping five variants. */}
      {band && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="score-aurora animate-score-drift absolute -right-1/4 -top-1/2 h-[38rem] w-[38rem]" />
          <div className="score-aurora animate-score-drift-slow absolute -right-1/3 -top-2/3 h-[30rem] w-[30rem] opacity-80" />
        </div>
      )}

      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6 sm:p-7">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 text-sm text-white/50">{subtitle}</p>
          )}
        </div>

        {score !== null && score !== undefined && band ? (
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-label text-white/40">
              {scoreLabel}
            </p>
            <p
              className={clsx(
                'mt-1 text-5xl font-bold leading-none tabular-nums sm:text-6xl',
                band.onDark.text,
              )}
            >
              {score.toFixed(1)}
              <span className="ml-1 text-lg font-medium text-white/30">/100</span>
            </p>
            <span
              className={clsx(
                'mt-3 inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-label',
                band.onDark.chip,
              )}
            >
              {band.label}
            </span>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-label text-white/40">
              {scoreLabel}
            </p>
            <p className="mt-1 text-5xl font-bold leading-none text-white/25">—</p>
            <span className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-label text-white/50">
              Not Scored Yet
            </span>
          </div>
        )}
      </div>

      {/* Meter across the full width, with the band thresholds marked so
          the number has somewhere to sit rather than floating free. */}
      <div className="relative px-6 pb-6 sm:px-7 sm:pb-7">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
          {band && (
            <div
              className={clsx(
                'animate-score-fill absolute inset-y-0 left-0 w-full origin-left overflow-hidden rounded-full',
                band.onDark.bar,
              )}
              style={{
                // scaleX rather than width: a transform is composited on its
                // own, where width would force layout and paint each frame.
                transform: `scaleX(${pct / 100})`,
                transition: 'transform var(--dur-ui) var(--ease-out)',
              }}
            >
              {/* Light travelling along the fill. Not counter-scaled: the
                  sweep animates its own transform, which would override an
                  inline one, and a soft gradient squashed to ~88% reads no
                  differently. */}
              <span className="animate-score-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            </div>
          )}
          {[40, 60, 80, 90].map(t => (
            <span
              key={t}
              className="absolute inset-y-0 w-px bg-ink-950/60"
              style={{ left: `${t}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-label text-white/25">
          <span>Poor</span>
          <span>Satisfactory</span>
          <span>Good</span>
          <span>Very Good</span>
          <span>Excellent</span>
        </div>
      </div>

      {children && (
        <div className="relative border-t border-white/10 px-6 py-4 sm:px-7">
          {children}
        </div>
      )}
    </section>
  )
}

/**
 * Something is waiting on the person reading this. Deliberately loud —
 * black panel, red rule, red pulse — because the most common failure of
 * a KPI system is nobody noticing they are the bottleneck.
 */
export function ActionRequired({
  eyebrow = 'Action Required',
  title,
  body,
  to,
  cta,
}: {
  eyebrow?: string
  title: string
  body?: ReactNode
  to: string
  cta: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-ink-950 text-white">
      <span className="absolute inset-y-0 left-0 w-1 bg-cyrixRed-600" />
      <div className="flex flex-wrap items-center gap-5 p-5 pl-7">
        {/* Three pulses, then still. This panel stays until the work is
            done, so an infinite ping would put permanent motion in the
            corner of a screen someone reads every day — attention-getting
            once, noise thereafter. */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-alert-ping absolute inline-flex h-full w-full rounded-full bg-cyrixRed-600" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyrixRed-600" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-label text-cyrixRed-400">
            {eyebrow}
          </p>
          <p className="mt-1.5 text-lg font-semibold">{title}</p>
          {body && <div className="mt-1 text-sm text-white/60">{body}</div>}
        </div>

        <Link
          to={to}
          className="btn-press shrink-0 bg-white px-6 py-3 text-[12px] font-bold uppercase tracking-label text-ink-950 hover:bg-cyrixRed-600 hover:text-white"
        >
          {cta}
        </Link>
      </div>
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
  if (!trend) return <span className="text-xs text-ink-400">Not enough months yet</span>

  const cfg = {
    up:   { Icon: TrendingUp,   cls: 'text-emerald-700',   text: `Improving +${trend.delta}` },
    down: { Icon: TrendingDown, cls: 'text-cyrixRed-700',  text: `Declining ${trend.delta}` },
    flat: { Icon: Minus,        cls: 'text-ink-500',       text: 'Steady' },
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
              <p className="text-[11px] text-ink-400">Of weightage</p>
            </div>
            <span className={clsx('badge', band.chip)}>{band.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Attainment per KRA.
 *
 * Grouped by section rather than sorted purely by percentage: core values
 * are not a job-role KRA and are the same row for everyone, so mixing
 * them into the job-role ranking invites a false comparison. Job role
 * first, weakest at the top; core values always last, on its own.
 */
export function KraBars({ rows }: { rows: KraAttainmentRow[] }) {
  const byKra = new Map<string, { section: string; total: number; n: number }>()
  for (const r of rows) {
    if (r.attainment_pct === null) continue
    const cur = byKra.get(r.kra) ?? { section: r.section, total: 0, n: 0 }
    cur.total += r.attainment_pct
    cur.n += 1
    byKra.set(r.kra, cur)
  }

  const all = [...byKra.entries()].map(([kra, v]) => ({
    kra, section: v.section, pct: v.total / v.n,
  }))
  const jobRole = all.filter(i => i.section === 'job_role').sort((a, b) => a.pct - b.pct)
  const coreValues = all.filter(i => i.section === 'core_values')

  if (all.length === 0) {
    return <p className="text-sm text-ink-500">No scored months yet.</p>
  }

  return (
    <div className="space-y-4">
      {jobRole.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
            Job Role — 80%
          </p>
          {jobRole.map(i => <Bar key={i.kra} kra={i.kra} pct={i.pct} />)}
        </div>
      )}

      {coreValues.length > 0 && (
        <div className="space-y-3 border-t border-ink-100 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
            Core Values — 20%
          </p>
          {coreValues.map(i => <Bar key={i.kra} kra={i.kra} pct={i.pct} />)}
        </div>
      )}

      <p className="pt-1 text-[11px] text-ink-400">
        The marker sits at {WEAK_THRESHOLD}% — anything left of it is below Good.
      </p>
    </div>
  )
}

function Bar({ kra, pct }: { kra: string; pct: number }) {
  const band = bandFor(pct) as Band
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="truncate text-sm text-ink-700">{kra}</span>
        <span className={clsx('text-xs font-semibold tabular-nums', band.accent)}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-ink-100">
        {/* scaleX, not width: a transform is composited on its own, where
            width forces layout and paint. Same reason as the score meter. */}
        <div
          className={clsx('absolute inset-y-0 left-0 w-full origin-left rounded-full', band.bar)}
          style={{
            transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`,
            transition: 'transform var(--dur-ui) var(--ease-out)',
          }}
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
}
