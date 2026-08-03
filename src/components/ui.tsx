import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { bandFor } from '@/lib/bands'
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
    <div className={clsx('flex gap-3 rounded-lg border p-3.5 text-sm', styles)}>
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-1')}>{children}</div>}
      </div>
    </div>
  )
}

const SUBMISSION_BADGES: Record<SubmissionStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',              cls: 'bg-ink-100 text-ink-700' },
  submitted: { label: 'Awaiting manager',   cls: 'bg-amber-100 text-amber-800' },
  returned:  { label: 'Returned to you',    cls: 'bg-orange-100 text-orange-800' },
  scored:    { label: 'Scored',             cls: 'bg-ink-900 text-white' },
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
}: {
  status: SubmissionStatus | AssignmentStatus | null
  kind?: 'submission' | 'assignment'
}) {
  if (!status) {
    return <span className="badge bg-ink-100 text-ink-500">Not started</span>
  }
  const map = kind === 'submission' ? SUBMISSION_BADGES : ASSIGNMENT_BADGES
  const cfg = (map as Record<string, { label: string; cls: string }>)[status]
  if (!cfg) return <span className="badge bg-ink-100 text-ink-500">{status}</span>
  return <span className={clsx('badge', cfg.cls)}>{cfg.label}</span>
}

/** A score out of 100, coloured by band. */
export function ScorePill({
  value,
  size = 'md',
}: {
  value: number | null | undefined
  size?: 'sm' | 'md' | 'lg'
}) {
  if (value === null || value === undefined) {
    return <span className="text-ink-400">—</span>
  }
  // Colour comes from the same band scale as everything else. This used to
  // carry its own thresholds (85/70/55), so one score could be emerald here
  // and "Very Good" lime in the hero — two answers for the same number.
  const cls = bandFor(value)?.chip ?? 'bg-ink-100 text-ink-700'
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
