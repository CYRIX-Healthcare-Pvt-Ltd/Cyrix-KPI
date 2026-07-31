import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import type { SubmissionStatus, AssignmentStatus } from '@/types/db'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className ?? 'h-5 w-5')} />
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-500">
      <Spinner className="h-7 w-7" />
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
  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    error: 'bg-red-50 border-red-200 text-red-900',
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
  scored:    { label: 'Scored',             cls: 'bg-blue-100 text-blue-800' },
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
  const cls =
    value >= 85 ? 'bg-emerald-100 text-emerald-800'
    : value >= 70 ? 'bg-blue-100 text-blue-800'
    : value >= 55 ? 'bg-amber-100 text-amber-800'
    : 'bg-red-100 text-red-800'
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
    <div className={clsx('card p-4', tone === 'brand' && 'border-ink-300 bg-ink-100')}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
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
