import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Trophy, Users,
} from 'lucide-react'
import {
  bandFor, isWeak, trendOf, bandScaleGradient, BAND_SCALE, WEAK_THRESHOLD,
  type Band,
} from '@/lib/bands'
import { SECTION_SHORT } from '@/lib/sections'
import type { KraAttainmentRow, WeakAreaRow, KraBenchmarkRow } from '@/types/db'

/** Built once — it is the same five stops on every hero on every screen. */
const SCALE = bandScaleGradient()

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
    <section
      className="relative overflow-hidden rounded-2xl bg-ink-950 text-white"
      // The wash takes its colour from THIS header's band, not the page
      // tint. They diverge whenever a screen reports on someone other than
      // the reader — a team average, a report's year — and a green glow
      // behind an orange score reads as a bug, because it is one.
      style={band ? ({ '--hero-accent': band.hex.base } as CSSProperties) : undefined}
    >
      {/* Band-coloured light drifting from the top-right corner down toward
          the bottom-left and back. Two layers on different periods so they
          separate and rejoin, which stops the loop reading as a loop.

          Both layers size and position themselves as a share of this panel
          — see .score-aurora — so the composition holds on a tall phone
          card and a wide desktop letterbox alike. */}
      {band && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="score-aurora animate-score-drift" />
          <div className="score-aurora score-aurora-alt animate-score-drift-slow opacity-80" />
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
          the number has somewhere to sit rather than floating free.

          The track carries the whole scale, dimmed: red at the bottom
          through to green at the top. It used to be plain grey, so a
          green bar looked like the only colour the meter had, and people
          asked — reasonably — how they would ever know a low score looks
          different. Now the answer is on screen: the bar is bright over
          the part that is earned, and the rest of the scale it is sitting
          on stays visible behind it. */}
      <div className="relative px-6 pb-6 sm:px-7 sm:pb-7">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
          {/* The rest of the scale, dimmed — where this score could go. */}
          <div
            className="absolute inset-0 opacity-25"
            style={{ backgroundImage: SCALE }}
            aria-hidden
          />
          {band && (
            <div
              className="animate-score-reveal absolute inset-0 overflow-hidden rounded-full"
              style={{
                // The same gradient, full strength, laid out across the
                // whole track and clipped at the score. Clipped rather
                // than scaled: scaling would drag the band boundaries off
                // the tick marks that mark them.
                backgroundImage: SCALE,
                ['--fill-rest' as string]: `${100 - pct}%`,
                clipPath: 'inset(0 var(--fill-rest) 0 0)',
                transition: 'clip-path var(--dur-ui) var(--ease-out)',
              }}
            >
              {/* Light travelling along the earned part. */}
              <span className="animate-score-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            </div>
          )}
          {/* Read off the same scale as the gradient, so a threshold and
              its tick mark cannot end up in different places. */}
          {BAND_SCALE.slice(1).map(({ band: b, from }) => (
            <span
              key={b.key}
              className="absolute inset-y-0 w-px bg-ink-950/60"
              style={{ left: `${from}%` }}
            />
          ))}
        </div>
        {/* Each label in its own band's colour, so the legend explains
            the track without a key. The one being scored is brought to
            full strength — where you are, on a scale you can see.

            Label tracking is bought back on a phone. Five uppercase words
            across 295px come to 287px of text, of which 64px is letter
            spacing, leaving 2px between one word and the next — close
            enough that POOR SATISFACTORY reads as one phrase. Loosened
            again at sm, where there is room for it. */}
        <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-[0.02em] sm:tracking-label">
          {BAND_SCALE.map(({ band: b }) => (
            <span
              key={b.key}
              style={{ color: b.hex.base }}
              className={clsx(
                'transition-opacity',
                band?.key === b.key ? 'opacity-100' : 'opacity-40',
              )}
            >
              {b.label}
            </span>
          ))}
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
      {/*
        Stacked on a phone, side by side from 640px up.

        This was one flex row with flex-wrap, which does not do what it
        looks like it does: the button is shrink-0 and the text is flex-1,
        so flex-basis is 0 and the text has no width it can insist on. It
        never triggered a wrap — it just gave up its own width until the
        heading was breaking one word per line beside a button that had
        taken half a 375px screen. Wrapping needs a stated width to fail
        against, so the breakpoint states it instead.
      */}
      <div className="flex flex-col gap-4 p-5 pl-7 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {/* Three pulses, then still. This panel stays until the work is
              done, so an infinite ping would put permanent motion in the
              corner of a screen someone reads every day — attention-getting
              once, noise thereafter.

              Aligned to the eyebrow rather than centred on the block: a
              marker for the whole card reads as deliberate at the top and
              as an accident when it is floating beside line three. */}
          <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
            <span className="animate-alert-ping absolute inline-flex h-full w-full rounded-full bg-cyrixRed-600" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyrixRed-600" />
          </span>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-label text-cyrixRed-400">
              {eyebrow}
            </p>
            <p className="mt-1.5 text-lg font-semibold">{title}</p>
            {body && <div className="mt-1 text-sm text-white/60">{body}</div>}
          </div>
        </div>

        {/* Full width on a phone — a call to action the thumb can hit
            without aiming — and rounded like every other button in the
            app, which this one had never been. */}
        <Link
          to={to}
          className="btn-press shrink-0 rounded-lg bg-white px-6 py-3 text-center text-[12px] font-bold uppercase tracking-label text-ink-950 hover:bg-cyrixRed-600 hover:text-white"
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

/**
 * Which way the last few months are going.
 *
 * Only ever shown somewhere that says what it is — the Trend column of
 * the team table, or beside a name in a list of scores. Never under the
 * hero meter: sitting directly below the band scale it read as a caption
 * explaining the bar, and nobody could tell what "Steady" was steady
 * about.
 *
 * Nothing at all with fewer than two months. There is no trend yet, and
 * saying so out loud fills the space with an apology instead of leaving
 * it empty — the number of months is already on screen everywhere this
 * appears.
 */
export function TrendChip({ scores }: { scores: Array<number | null> }) {
  const trend = trendOf(scores)
  if (!trend) return null

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
  attainment,
  benchmark,
  emptyMessage = 'Nothing below Good — all areas are on track.',
}: {
  areas: WeakAreaRow[]
  /**
   * Month-by-month readings, so an area that is still fine but heading
   * down can be named. "Every area is at Good or better" is true of
   * somebody whose best KRA has dropped twenty points in two months, and
   * it is the last thing they need to be told.
   */
  attainment?: KraAttainmentRow[]
  /**
   * Where you stand against people with the same KPI. An average and a
   * headcount from the server — see my_kra_benchmark(). Never a name.
   */
  benchmark?: KraBenchmarkRow[]
  emptyMessage?: string
}) {
  const weak = areas
    .filter(a => isWeak(a.avg_attainment_pct))
    .sort((a, b) => (a.avg_attainment_pct ?? 0) - (b.avg_attainment_pct ?? 0))

  // Falling but not yet weak. Excluded from the list above so nothing is
  // reported twice, and shown even when that list is empty.
  const slipping = fallingAreas(attainment ?? [])
    .filter(f => !weak.some(w => w.kra === f.kra))

  // Behind the people doing the same job. Five points is roughly a band
  // boundary at this scale; below that it is noise. Not repeated where
  // the area is already listed as weak or falling — one area, one line.
  const behind = (benchmark ?? [])
    .filter(b =>
      b.my_avg !== null && b.peer_avg !== null &&
      b.my_avg < b.peer_avg - 5 &&
      !weak.some(w => w.kra === b.kra) &&
      !slipping.some(f => f.kra === b.kra))
    .sort((a, b) => (a.my_avg! - a.peer_avg!) - (b.my_avg! - b.peer_avg!))

  if (weak.length === 0) {
    return (
      <div className="space-y-2">
        {slipping.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <Trophy className="h-4 w-4 shrink-0" />
            {emptyMessage}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <Trophy className="h-4 w-4 shrink-0" />
            Nothing is below Good — but the areas below are heading down.
          </div>
        )}
        {slipping.map(f => <SlippingRow key={f.kra} {...f} />)}
        {behind.map(b => <BehindRow key={b.kra} {...b} />)}
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {slipping.map(f => <li key={f.kra}><SlippingRow {...f} /></li>)}
      {behind.map(b => <li key={b.kra}><BehindRow {...b} /></li>)}
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
                {SECTION_SHORT[a.section] ?? a.section} · {a.months} month
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
 * Areas whose last two months are below the two before them.
 *
 * Averages hide this completely: a KRA at 95, 92, 78, 70 averages 84 and
 * is called fine. The direction is the finding, so it is reported on its
 * own terms rather than waiting for the average to sink far enough to
 * trip the weak-area threshold.
 */
export function fallingAreas(rows: KraAttainmentRow[]) {
  const byKra = new Map<string, Array<{ month: string; pct: number }>>()
  for (const r of rows) {
    if (r.attainment_pct === null) continue
    if (r.status !== 'scored' && r.status !== 'finalized') continue
    const list = byKra.get(r.kra) ?? []
    list.push({ month: r.period_month, pct: r.attainment_pct })
    byKra.set(r.kra, list)
  }

  const out: Array<{ kra: string; delta: number; latest: number; months: number }> = []
  for (const [kra, list] of byKra) {
    const ordered = [...list].sort((a, b) => a.month.localeCompare(b.month))
    const trend = trendOf(ordered.map(r => r.pct))
    if (trend?.direction !== 'down') continue
    out.push({
      kra,
      delta: trend.delta,
      latest: ordered[ordered.length - 1].pct,
      months: ordered.length,
    })
  }
  return out.sort((a, b) => a.delta - b.delta)
}

/**
 * You against everybody with the same KPI, on one area.
 *
 * Deliberately an average and a headcount and nothing else. The point is
 * to say "there is room here", not to let somebody work out what a named
 * colleague scored — which is why the server refuses to answer at all
 * for a group of fewer than three.
 */
function BehindRow({
  kra, my_avg, peer_avg, peers,
}: KraBenchmarkRow) {
  const gap = (peer_avg ?? 0) - (my_avg ?? 0)
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-200 p-3">
      <Users className="h-4 w-4 shrink-0 text-ink-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{kra}</p>
        <p className="text-xs text-ink-500">
          The {peers} others doing this job average {peer_avg!.toFixed(0)}%
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-ink-800">
          {my_avg!.toFixed(0)}%
        </p>
        <p className="text-[11px] text-ink-400">{gap.toFixed(0)} behind</p>
      </div>
    </div>
  )
}

function SlippingRow({
  kra, delta, latest, months,
}: {
  kra: string; delta: number; latest: number; months: number
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <TrendingDown className="h-4 w-4 shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{kra}</p>
        <p className="text-xs text-amber-800">
          Down {Math.abs(delta).toFixed(0)} points over the last two months
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-ink-800">
          {latest.toFixed(0)}%
        </p>
        <p className="text-[11px] text-ink-400">latest of {months}</p>
      </div>
    </div>
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
  // The standard bands, in the order they appear on the KPI. Kept out of
  // the job-role ranking and out of each other's: a weak ESMS month and a
  // weak KRA are different problems with different owners.
  const standard = (['esms', 'core_values'] as const)
    .map(key => ({ key, rows: all.filter(i => i.section === key) }))
    .filter(g => g.rows.length > 0)

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

      {standard.map(({ key, rows: group }) => (
        <div key={key} className="space-y-3 border-t border-ink-100 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
            {SECTION_SHORT[key]}
          </p>
          {group.map(i => <Bar key={i.kra} kra={i.kra} pct={i.pct} />)}
        </div>
      ))}

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
