import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { bandFor, attainmentPct } from '@/lib/bands'
import type { SubmissionStatus, AssignmentStatus } from '@/types/db'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className ?? 'h-5 w-5')} />
}

/**
 * Five bars, staggered, in the signed-in person's own band colour.
 *
 * The heights are fixed and uneven — a chart, not a row of sticks — and
 * only the vertical scale animates on top of them. 70ms apart: far
 * enough to read as a wave travelling left to right, close enough that
 * the whole set is moving at once rather than taking turns.
 *
 * Deliberately not a progress bar. A bar that fills is a promise about
 * how long this will take, and nothing here knows that.
 */
export function ChartLoader({ className }: { className?: string }) {
  const bars = [0.55, 0.8, 1, 0.65, 0.9]
  return (
    <div
      className={clsx('flex items-end gap-[3px]', className ?? 'h-7')}
      role="status"
      aria-label="Loading"
    >
      {bars.map((h, i) => (
        <span
          key={i}
          className="animate-chart-bar w-[5px] rounded-sm"
          style={{
            height: `${h * 100}%`,
            animationDelay: `${i * 70}ms`,
            backgroundColor: 'var(--score-accent)',
          }}
        />
      ))}
    </div>
  )
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-500">
      <ChartLoader />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function Alert({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'error' | 'success' | 'warning'
  title?: string
  children?: ReactNode
}) {
  /*
    An error comes to you, and then stays where you can see it.

    Scrolling it into view was the first attempt and was not enough: it
    fires once, and the moment somebody scrolls back down to the button
    that failed, the reason it failed is off screen again. On a page that
    is a month of KPI rows and five core values, that is most of the
    time.

    So an error also sticks. Its container is the whole page, so it stays
    pinned under the header for as long as you are anywhere on that page
    — the message and the button you are pressing are visible together,
    which is the actual requirement. Only errors: a success message that
    followed you down the page would be nagging.
  */
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (kind !== 'error' && kind !== 'warning') return
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [kind])

  // Informational uses the brand's ink rather than a blue — blue is not a
  // Cyrix colour, and an "FYI" panel does not need its own hue to read as
  // one. Error, warning and success keep their conventional meanings.
  const styles = {
    info: 'bg-ink-50 border-ink-200 text-ink-800',
    error: 'bg-cyrixRed-50 border-cyrixRed-200 text-cyrixRed-900',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
  }[kind]
  const Icon = { info: Info, error: AlertCircle, success: CheckCircle2, warning: AlertCircle }[kind]

  return (
    <div
      ref={ref}
      role={kind === 'error' ? 'alert' : undefined}
      className={clsx(
        'flex gap-3 rounded-lg border p-3.5 text-sm',
        styles,
        // top-16 clears the 56px sticky header with a little air. The
        // shadow is what stops it looking like part of whatever it has
        // ended up floating over.
        kind === 'error' && 'sticky top-16 z-20 shadow-lg',
      )}
    >
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-1')}>{children}</div>}
      </div>
    </div>
  )
}

/**
 * "040" → "40", and nothing else.
 *
 * Leading zeros pile up because these fields start at 0 and people type
 * after it. Only zeros with a digit behind them go, so "0" survives,
 * "0.5" survives, and a minus sign keeps its place — anything more
 * aggressive would eat the "4." somebody is halfway through typing as
 * "4.5".
 */
export const cleanNumberText = (raw: string) =>
  raw.replace(/^(-?)0+(?=\d)/, '$1')

/**
 * A number field that shows what it holds.
 *
 * React does not correct the displayed text on an input of type="number"
 * when the two are only loosely unequal — its check is `node.value !=
 * value`, and "040" loosely equals 40 — so a field bound to a number
 * keeps whatever string the typing left behind. Holding the text here
 * and canonicalising it on the way through is what makes the display and
 * the value agree.
 *
 * The effect re-syncs only when the model has genuinely moved elsewhere,
 * such as an Excel import or a template load. Without that guard it
 * would fight every keystroke.
 */
export function NumberInput({
  value, onValue, className, ...rest
}: {
  value: number | null
  onValue: (v: number | null) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState(value === null ? '' : String(value))

  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text)
    if (parsed === value) return
    setText(value === null ? '' : String(value))
    // Deliberately keyed on the model alone: reacting to text as well
    // would make every keystroke a candidate for being overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      className={className ?? 'input'}
      value={text}
      onChange={e => {
        const next = cleanNumberText(e.target.value)
        setText(next)
        const n = next.trim() === '' ? null : Number(next)
        onValue(n === null || Number.isNaN(n) ? null : n)
      }}
    />
  )
}

const SUBMISSION_BADGES: Record<SubmissionStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',              cls: 'bg-ink-100 text-ink-700' },
  submitted: { label: 'Awaiting manager',   cls: 'bg-amber-100 text-amber-800' },
  returned:  { label: 'Returned to you',    cls: 'bg-orange-100 text-orange-800' },
  // "Scored" told nobody anything: it named a database state, not a
  // step in the process, and people asked what it meant. This is what
  // has actually happened — the manager has been through it, and the
  // month is now waiting out its closing date.
  scored:    { label: 'Manager reviewed',   cls: 'bg-ink-900 text-onInk' },
  finalized: { label: 'Final',              cls: 'bg-emerald-100 text-emerald-800' },
}

const ASSIGNMENT_BADGES: Record<AssignmentStatus, { label: string; cls: string }> = {
  draft:            { label: 'Draft',              cls: 'bg-ink-100 text-ink-700' },
  pending_approval: { label: 'Awaiting approval',  cls: 'bg-amber-100 text-amber-800' },
  active:           { label: 'Approved',           cls: 'bg-emerald-100 text-emerald-800' },
  rejected:         { label: 'Sent back',          cls: 'bg-red-100 text-red-800' },
  archived:         { label: 'Archived',           cls: 'bg-ink-100 text-ink-500' },
}

export function StatusBadge({
  status,
  kind = 'submission',
  queried = false,
}: {
  status: SubmissionStatus | AssignmentStatus | null
  kind?: 'submission' | 'assignment'
  /**
   * A question is open on this month. It outranks the stored status,
   * because "Manager reviewed" is true and unhelpful while somebody is
   * waiting for an answer — and the month cannot close until they get
   * one, so the badge should say the thing that is actually holding it.
   */
  queried?: boolean
}) {
  if (!status) {
    return <span className="badge bg-ink-100 text-ink-500">Not started</span>
  }
  if (queried && (status === 'scored' || status === 'finalized')) {
    return <span className="badge bg-amber-100 text-amber-800">Under review</span>
  }
  const map = kind === 'submission' ? SUBMISSION_BADGES : ASSIGNMENT_BADGES
  const cfg = (map as Record<string, { label: string; cls: string }>)[status]
  if (!cfg) return <span className="badge bg-ink-100 text-ink-500">{status}</span>
  return <span className={clsx('badge', cfg.cls)}>{cfg.label}</span>
}

/** A score out of 100, coloured by band. */
export function ScorePill({
  value,
  outOf = 100,
  size = 'md',
}: {
  value: number | null | undefined
  /**
   * What this score is out of. A total is out of 100 and needs nothing;
   * a KRA worth 20 that earned 20 is a perfect row, and judging it
   * against 100 painted it red — the same Poor as a genuine 20/100.
   * Every score below the total is out of its own weightage, so the
   * band has to come from the share earned, not the raw figure.
   */
  outOf?: number
  size?: 'sm' | 'md' | 'lg'
}) {
  if (value === null || value === undefined) {
    return <span className="text-ink-400">—</span>
  }
  // Colour comes from the same band scale as everything else. This used to
  // carry its own thresholds (85/70/55), so one score could be emerald here
  // and "Very Good" lime in the hero — two answers for the same number.
  const cls = bandFor(attainmentPct(value, outOf))?.chip ?? 'bg-ink-100 text-ink-700'
  const sizeCls = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  }[size]

  return (
    <span className={clsx('inline-flex rounded-lg font-semibold tabular-nums', cls, sizeCls)}>
      {value.toFixed(2)}
    </span>
  )
}

/**
 * One score, with the bands it is made of underneath.
 *
 * Job role is 80 of the 100 and the rest barely moves between people, so
 * two months at 88 can be completely different months — one built on a
 * weak job role and a full core-values score, one the other way round.
 * The split is the part somebody can act on; the total is the part that
 * goes on a report. Both belong in the same cell.
 *
 * Whether ESMS is shown comes from the KPI rather than from the score,
 * so a person who carries it and has not been scored on it yet gets a
 * dash instead of the table quietly changing shape later.
 */
export function BandCell({
  total, job, esms, core, hasEsms, pill,
}: {
  total: number | null | undefined
  job: number | null | undefined
  esms: number | null | undefined
  core: number | null | undefined
  hasEsms: boolean
  pill?: boolean
}) {
  const parts: Array<[string, number | null | undefined]> = [
    ['Job', job],
    ...(hasEsms ? [['ESMS', esms] as [string, number | null | undefined]] : []),
    ['Core', core],
  ]
  return (
    <td className="px-4 py-3 text-right">
      {pill ? (
        <ScorePill value={total} size="sm" />
      ) : (
        <span className="tabular-nums text-ink-600">{total?.toFixed(2) ?? '—'}</span>
      )}
      {total !== null && total !== undefined && (
        <p className="mt-1 flex flex-wrap justify-end gap-x-2 text-[10px] leading-tight">
          {parts.map(([label, v]) => (
            <span key={label} className="whitespace-nowrap">
              <span className="text-ink-400">{label}</span>{' '}
              <span className="font-semibold tabular-nums text-ink-600">
                {v === null || v === undefined ? '—' : v.toFixed(1)}
              </span>
            </span>
          ))}
        </p>
      )}
    </td>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  children?: ReactNode
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      {Icon && <Icon className="h-9 w-9 text-ink-300" />}
      <p className="font-medium text-ink-700">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-500">{children}</div>}
    </div>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: string
  tone?: 'default' | 'brand'
}) {
  return (
    // A row of these should read as one band, so a tile carrying a caption
    // must not stand a line taller than the ones beside it.
    <div
      className={clsx(
        'card flex flex-col p-4',
        tone === 'brand' && 'border-ink-300 bg-ink-50',
      )}
    >
      <p className="label !mb-0">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
      {/* Always rendered, so a row of tiles keeps one baseline even
          when only some of them carry a caption. Height reserved in CSS
          rather than with a whitespace character. */}
      <p className="mt-0.5 min-h-4 text-xs text-ink-400">{sub}</p>
    </div>
  )
}

/** Section header for the 80% / 20% blocks. */
export function SectionHeader({
  title,
  weight,
  score,
}: {
  title: string
  weight: number
  score?: number | null
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
      <h3 className="text-sm font-semibold text-ink-800">
        {title} <span className="font-normal text-ink-500">— {weight}%</span>
      </h3>
      {score !== undefined && (
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <span>Score</span>
          <ScorePill value={score} size="sm" />
        </div>
      )}
    </div>
  )
}
