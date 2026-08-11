import clsx from 'clsx'
import { CalendarClock } from 'lucide-react'
import { fyMonths, monthLabel } from '@/lib/fy'
import { Spinner } from '@/components/ui'

/**
 * Which month a KPI starts from.
 *
 * The same control in three places — setting up a KPI, approving one, and
 * the prompt that collects the answer from everybody whose KPI predates
 * the question — so it lives here rather than being typed out three times
 * and drifting.
 */
export function StartMonthSelect({
  fy, value, onChange, disabled, id, className, placeholder,
}: {
  fy: string
  value: string
  onChange: (month: string) => void
  disabled?: boolean
  id?: string
  className?: string
  /**
   * Shown as a disabled first option while `value` is ''. For the
   * approval screen, where every KPI made before this existed has no
   * answer and pre-filling one would put a month nobody chose in front
   * of a manager about to press Approve.
   */
  placeholder?: string
}) {
  return (
    <select
      id={id}
      className={className ?? 'input'}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {fyMonths(fy).map(m => (
        <option key={m} value={m}>{monthLabel(m)}</option>
      ))}
    </select>
  )
}

/**
 * When this KPI starts, stated rather than implied.
 *
 * It used to be invisible once set — the KPI screens showed twelve
 * months' worth of contract with nothing saying which of them were
 * actually being asked for. Somebody's whole year hinges on it, so it
 * gets a band of its own above the rows rather than a line of small
 * print underneath them.
 *
 * Read-only for the person being appraised; editable wherever the
 * manager is, because they are the one who knows.
 */
export function StartMonthBanner({
  fy, startsFrom, who, editable, onChange, busy,
}: {
  fy: string
  startsFrom: string | null
  /** Whose KPI it is, for the manager's copy. Omit for "your own". */
  who?: string
  editable?: boolean
  onChange?: (month: string) => void
  busy?: boolean
}) {
  const months = fyMonths(fy)
  const skipped = startsFrom ? Math.max(0, months.indexOf(startsFrom)) : 0
  const name = who ?? 'You'
  const isSelf = !who

  return (
    <div className={clsx(
      'card flex flex-wrap items-center gap-x-4 gap-y-3 p-4',
      // Unanswered is a problem, and looks like one. Answered is simply
      // a fact about the year and is not shouted at anybody.
      !startsFrom && 'border-amber-300 bg-amber-50',
    )}>
      <span className={clsx(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        startsFrom ? 'bg-ink-100' : 'bg-amber-100',
      )}>
        <CalendarClock className={clsx(
          'h-5 w-5', startsFrom ? 'text-ink-500' : 'text-amber-700',
        )} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
          This KPI starts from
        </p>
        <p className="mt-0.5 text-lg font-semibold text-ink-900">
          {startsFrom ? monthLabel(startsFrom) : 'Not set yet'}
        </p>
        <p className="mt-0.5 text-sm text-ink-500">
          {!startsFrom
            ? `Until this is set, every month of FY ${fy} counts as ${
                isSelf ? 'yours' : 'theirs'}.`
            : skipped === 0
              ? `The whole of FY ${fy} — all twelve months are assessed.`
              : `${monthLabel(months[0])} to ${monthLabel(months[skipped - 1])} ` +
                `${skipped === 1 ? 'is' : 'are'} not assessed. ` +
                `${name} ${isSelf ? 'are' : 'is'} measured on ` +
                `${months.length - skipped} months this year.`}
        </p>
      </div>

      {editable && onChange && (
        <div className="flex shrink-0 items-center gap-2">
          {busy && <Spinner className="h-4 w-4 text-ink-400" />}
          <StartMonthSelect
            fy={fy}
            value={startsFrom ?? ''}
            onChange={onChange}
            placeholder="Choose a month"
            className="input w-auto"
          />
        </div>
      )}
    </div>
  )
}

/**
 * The explanation, worded for whoever is reading it.
 *
 * Kept beside the control because the question looks obvious and is not:
 * the instinct is to answer "this month", and the right answer is the
 * month the work started being measured.
 */
export function StartMonthNote({ who = 'you' }: { who?: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-500">
      <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
      <span>
        April if {who} {who === 'you' ? 'were' : 'was'} here for the whole
        year. Pick the joining month otherwise — the months before it stop
        being asked for, and stop counting as missing.
      </span>
    </p>
  )
}
